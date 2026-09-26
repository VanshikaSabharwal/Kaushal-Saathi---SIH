/**
 * The planning side: dashboard numbers, district insights, the perspective
 * plan export, placement, and the consultant registry.
 *
 * These answer the GIA issues the problem statement lists beside the
 * interview itself — no roadmap for planning, weak placement, coordination
 * across offices, and identifying skilled financial consultants — from the
 * same records the conversations produce.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import employersFile from "../data/employers.json";
import { CENTRES, COURSES, DISTRICTS, getCourse, getDistrict, skillLabel } from "../lib/livelihood/catalog";
import { setConsultantRegistry } from "../lib/livelihood/consultants";
import { allOpportunities } from "../lib/livelihood/opportunities";
import type { Language, Sector } from "../lib/livelihood/types";
import { completionModel } from "../lib/ml/model";
import { kmeans, profileVector } from "../lib/ml/kmeans";
import { beneficiaries, STATUSES, type Beneficiary, type BeneficiaryStatus } from "../lib/store/beneficiaries";
import { consultants, liveRegistry, registerConsultant, scoreOf } from "../lib/store/consultants";
import { canSee, canSeeTask, type Scope } from "../lib/store/scope";
import { outcomeRates } from "../lib/store/sync";
import { tasks, type Task } from "../lib/store/tasks";

type Helpers = {
  json: (res: ServerResponse, status: number, body: unknown) => void;
  readJson: (req: IncomingMessage) => Promise<Record<string, unknown>>;
};

type Employer = { id: string; name: string; district: string; block: string; sectors: Sector[]; openings: number; sample: boolean };
const EMPLOYERS = employersFile.employers as Employer[];

const ALL_STATUSES: BeneficiaryStatus[] = [...STATUSES, "dropped"];
const OFFICERS = new Set(["internal", "ministry", "state", "district"]);

/** A batch is planned around this many trainees. */
const BATCH_SIZE = 25;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

async function scoped(scope: Scope, district?: string): Promise<Beneficiary[]> {
  const all = await beneficiaries.list(district ? ({ district } as Partial<Beneficiary>) : {}, { limit: 100000 });
  return all.filter((b) => canSee(scope, b));
}

/** The district a request is about: the officer's own, or the one asked for. */
function districtFor(scope: Scope, url: URL): string | undefined {
  return scope.role === "district" || scope.role === "saathi" ? scope.district : url.searchParams.get("district") ?? undefined;
}

function sectorOf(courseId?: string): Sector | undefined {
  return courseId ? getCourse(courseId)?.sector : undefined;
}

export async function handleInsightsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  scope: Scope,
  { json, readJson }: Helpers,
): Promise<boolean> {
  const route = `${req.method} ${url.pathname}`;
  const district = districtFor(scope, url);

  switch (route) {
    case "GET /internal/stats": {
      const all = await scoped(scope, district);
      const open = (await tasks.list({ status: "open" } as Partial<Task>, { limit: 100000 })).filter((t) => canSeeTask(scope, t));
      const now = Date.now();

      const byStatus = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0]));
      for (const b of all) byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;

      const model = completionModel();

      json(res, 200, {
        total: all.length,
        byStatus,
        openTasks: open.length,
        overdueTasks: open.filter((t) => t.dueAt < now).length,
        openByType: open.reduce<Record<string, number>>((m, t) => ((m[t.type] = (m[t.type] ?? 0) + 1), m), {}),
        flagged: {
          handoff: all.filter((b) => b.flags.includes("handoff")).length,
          misheard: all.filter((b) => b.flags.includes("misheard")).length,
          llmUsed: all.filter((b) => b.flags.includes("llm_used")).length,
          notPlaced: all.filter((b) => b.flags.includes("not_placed")).length,
        },
        // Where people leave the interview: the last question they were asked.
        dropOff: all
          .filter((b) => b.status === "profiling" && b.interview.stage === "slot")
          .reduce<Record<string, number>>((m, b) => {
            const next = ["district", "block", "education", "currentWork", "familyTrade", "continueFamilyTrade", "interests", "preference", "travel", "hours", "learning", "familySupport", "constraints", "assets", "aspiration"]
              .find((s) => !b.interview.answered.includes(s as never)) ?? "summary";
            m[next] = (m[next] ?? 0) + 1;
            return m;
          }, {}),
        model: model && { source: model.source, trainedAt: model.trainedAt, auc: model.metrics.auc, baselineAuc: model.metrics.baselineAuc },
      });
      return true;
    }

    case "GET /internal/insights": {
      if (!district) {
        json(res, 400, { error: "Choose a district." });
        return true;
      }

      const d = getDistrict(district);
      const all = await scoped(scope, district);

      // Skill gaps: what the people here most need to learn, across their top pick.
      const gapCounts: Record<string, number> = {};
      for (const b of all) {
        const top = b.recommendations.find((r) => r.courseId === b.chosen?.courseId) ?? b.recommendations[0];
        top?.need.forEach((s) => (gapCounts[s] = (gapCounts[s] ?? 0) + 1));
      }

      // Demand (district documents) vs interest (people) vs supply (centres).
      const sectors = Object.keys(d?.demand ?? {}).map((sector) => {
        const courseIds = COURSES.filter((c) => c.sector === sector).map((c) => c.id);
        return {
          sector,
          demand: d?.demand[sector as Sector] ?? 0,
          interested: all.filter((b) => b.profile.interestSectors?.includes(sector as Sector)).length,
          chosen: all.filter((b) => sectorOf(b.chosen?.courseId) === sector).length,
          centres: CENTRES.filter((c) => c.district === district && c.courses.some((id) => courseIds.includes(id))).length,
        };
      }).sort((a, b) => b.interested - a.interested || b.demand - a.demand);

      const registry = await liveRegistry();
      const coverage = (d?.blocks ?? []).map((b) => {
        const available = registry.filter(
          (c) => c.district === district && c.verified && c.blocks.includes(b.name) && c.activeCases < c.capacity,
        );
        return { block: b.name, blockHi: b.nameHi, consultants: available.length, gap: available.length === 0 };
      });

      const completed = all.filter((b) => b.interview.answered.length >= 5);

      json(res, 200, {
        district: d && { id: d.id, name: d.name, nameHi: d.nameHi, state: d.state },
        people: all.length,
        skillGaps: Object.entries(gapCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .map(([skill, count]) => ({ skill, en: skillLabel(skill, "en"), hi: skillLabel(skill, "hi"), count })),
        sectors,
        clusters: kmeans(completed.map((b) => profileVector(b.profile)), 4),
        consultantCoverage: coverage,
        opportunities: allOpportunities(district),
        outcomes: outcomeRates(all),
      });
      return true;
    }

    case "GET /internal/plan": {
      // The perspective plan: batches needed per block and sector, from the
      // people who chose a course and the centres that could run it.
      if (!district) {
        json(res, 400, { error: "Choose a district." });
        return true;
      }

      const all = await scoped(scope, district);
      const d = getDistrict(district);
      const rows: string[] = ["block,sector,course,interested_people,batches_needed,centres_in_district,gap"];
      const byKey = new Map<string, { block: string; courseId: string; n: number }>();

      for (const b of all) {
        if (!b.chosen) continue;
        const key = `${b.block}|${b.chosen.courseId}`;
        const e = byKey.get(key) ?? { block: b.block ?? "", courseId: b.chosen.courseId, n: 0 };
        e.n++;
        byKey.set(key, e);
      }

      for (const e of [...byKey.values()].sort((a, b) => b.n - a.n)) {
        const course = getCourse(e.courseId);
        const centres = CENTRES.filter((c) => c.district === district && c.courses.includes(e.courseId)).length;
        rows.push([e.block, course?.sector, `"${course?.name}"`, e.n, Math.ceil(e.n / BATCH_SIZE), centres, centres === 0 ? "no centre" : ""].join(","));
      }

      json(res, 200, { district: d?.name, csv: rows.join("\n") });
      return true;
    }

    case "GET /internal/placement": {
      const all = await scoped(scope, district);
      const certified = all.filter((b) => b.status === "certified");

      const employers = EMPLOYERS.filter((e) => !district || e.district === district).map((e) => ({
        ...e,
        shortlist: certified
          .filter((b) => b.district === e.district && e.sectors.includes(sectorOf(b.chosen?.courseId) as Sector))
          .map((b) => ({ id: b.id, block: b.block, courseId: b.chosen?.courseId, phone: b.phone })),
      }));

      json(res, 200, {
        pipeline: Object.fromEntries(ALL_STATUSES.map((s) => [s, all.filter((b) => b.status === s).length])),
        employers,
        outcomes: outcomeRates(all),
      });
      return true;
    }

    case "GET /internal/consultants": {
      const registry = (await liveRegistry()).filter(
        (c) =>
          (!district || c.district === district) &&
          (scope.role !== "state" || DISTRICTS.find((x) => x.id === c.district)?.state === scope.state) &&
          (scope.role !== "consultant" || c.id === scope.consultantId),
      );

      const withScores = await Promise.all(registry.map(async (c) => ({ ...c, performance: await scoreOf(c.id) })));
      json(res, 200, { consultants: withScores });
      return true;
    }

    case "POST /internal/consultants": {
      if (!OFFICERS.has(scope.role)) {
        json(res, 403, { error: "Only an officer can register a consultant." });
        return true;
      }

      const body = await readJson(req);
      const name = str(body.name);
      const d = str(body.district) ?? scope.district;

      if (!name || !d || !getDistrict(d)) {
        json(res, 400, { error: "Need name and a known district." });
        return true;
      }

      const record = await registerConsultant({
        id: `fc_${Date.now().toString(36)}`,
        name,
        district: d,
        blocks: Array.isArray(body.blocks) ? body.blocks.map(String) : [],
        languages: (Array.isArray(body.languages) ? body.languages.map(String) : ["hi"]) as Language[],
        specialisations: Array.isArray(body.specialisations) ? body.specialisations.map(String) : [],
        capacity: Math.max(1, Number(body.capacity) || 20),
        phone: str(body.phone),
        certifications: Array.isArray(body.certifications) ? body.certifications.map(String) : [],
      });

      setConsultantRegistry(await liveRegistry());
      json(res, 200, { consultant: record });
      return true;
    }

    case "POST /internal/consultants/verify": {
      if (!OFFICERS.has(scope.role)) {
        json(res, 403, { error: "Only an officer can verify a consultant." });
        return true;
      }

      const body = await readJson(req);
      const c = await consultants.update(str(body.id) ?? "", (x) =>
        x ? { ...x, verified: body.verified !== false, verifiedBy: scope.role } : null,
      );

      // Takes effect on the very next match.
      setConsultantRegistry(await liveRegistry());
      json(res, c ? 200 : 404, c ? { consultant: c } : { error: "No such consultant." });
      return true;
    }

    case "POST /internal/consultants/loan": {
      // A consultant (or officer) records a loan decision for a case.
      const body = await readJson(req);
      const b = await beneficiaries.get(str(body.beneficiaryId) ?? "");

      const allowed =
        b &&
        canSee(scope, b) &&
        (OFFICERS.has(scope.role) || (scope.role === "consultant" && b.chosen?.consultantId === scope.consultantId));

      if (!b || !allowed || typeof body.sanctioned !== "boolean") {
        json(res, 400, { error: "Need a visible beneficiaryId and sanctioned: true|false." });
        return true;
      }

      const updated = await beneficiaries.update(b.id, (x) =>
        x
          ? {
              ...x,
              updatedAt: Date.now(),
              timeline: [
                ...x.timeline,
                {
                  at: Date.now(),
                  type: "loan",
                  by: scope.role === "consultant" ? "consultant" : "officer",
                  note: str(body.note),
                  data: { sanctioned: body.sanctioned, scheme: str(body.scheme) },
                },
              ],
            }
          : null,
      );

      json(res, 200, { beneficiary: updated });
      return true;
    }
  }

  return false;
}
