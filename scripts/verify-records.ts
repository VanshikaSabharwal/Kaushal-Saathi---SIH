/**
 * Beneficiary records, tasks and unknown words, end to end on the file store.
 * Runs in a throwaway directory with MongoDB disabled, so it touches neither
 * the project's .data nor any database. No keys. Run: npm run verify:records
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n        ${detail}`}`);
}

async function main(): Promise<void> {
  // Before any store module loads: they resolve .data from the working
  // directory, and must never see the real database.
  delete process.env.MONGODB_URL;
  process.chdir(await mkdtemp(path.join(tmpdir(), "kaushal-records-")));

  const { startInterview, step, resumeInterview, canResume } = await import("../lib/livelihood/interview");
  const store = await import("../lib/store/beneficiaries");
  const { tasks } = await import("../lib/store/tasks");
  const { unknownWords } = await import("../lib/store/unknown-words");
  const { handleLivelihoodRoute } = await import("../voice-server/livelihood-routes");

  type State = Awaited<ReturnType<typeof step>>["state"];

  /** Drive a conversation, saving after every step exactly as the voice server does. */
  async function run(beneficiaryId: string, lines: string[]): Promise<State> {
    let r = startInterview();
    for (const text of lines) {
      r = await step(r.state, text);
      await store.applyInterviewEvents(beneficiaryId, r.events, r.state);
    }
    return r.state;
  }

  async function person(phone?: string) {
    const b = store.newBeneficiary({ phone });
    await store.startCallFor(b.id, `call-${Math.random()}`, b);
    return b.id;
  }

  console.log("Records\n");

  /* A full interview leaves a complete record and an enrolment task. */
  {
    const id = await person("+910000000001");
    await run(id, [
      "हाँ जी", "मैं बबीना से हूँ", "आठवीं तक पढ़ा हूँ", "पंक्चर की दुकान पर काम करता हूँ",
      "पापा साइकिल ठीक करते थे", "हाँ, आगे बढ़ाना है", "मोटरसाइकिल और इंजन का काम", "अपना काम खोलना है",
      "बीस किलोमीटर तक", "पूरा दिन", "हाथ से करके", "हाँ", "नहीं, कोई दिक्कत नहीं", "औज़ार हैं मेरे पास",
      "अपनी वर्कशॉप खोलना चाहता हूँ", "हाँ सही है", "पहला", "हाँ",
    ]);

    const b = (await store.beneficiaries.get(id))!;
    const types = b.timeline.map((t) => t.type);

    check("Record: status is interested", b.status === "interested", b.status);
    check("Record: district and block kept at top level", b.district === "jhansi" && b.block === "Babina");
    check("Record: chosen course and centre", b.chosen?.courseId === "c_2w_service" && b.chosen.centreId === "j2", JSON.stringify(b.chosen));
    check("Record: consultant carried onto the choice", b.chosen?.consultantId === "fc_j1", b.chosen?.consultantId);
    check("Record: three recommendations with their gaps", b.recommendations.length === 3 && b.recommendations[0].need.includes("engine_basics"));
    check(
      "Record: timeline in order",
      ["call_started", "profile_completed", "recommended", "interested"].every((t, i, a) => types.indexOf(t) > (i ? types.indexOf(a[i - 1]) : -1)),
      types.join(" > "),
    );

    const enrol = await tasks.list({ beneficiaryId: id, type: "enrol" });
    check("Task: enrolment opened for the centre", enrol.length === 1 && enrol[0].owner === "centre" && enrol[0].status === "open");

    /* An officer moves them on; a later call must not drag them back. */
    await store.setStatus(id, "certified", "officer", "passed assessment");
    await run(id, ["हाँ जी", "मैं बबीना से हूँ", "आठवीं", "पंक्चर", "साइकिल", "हाँ", "गाड़ी", "अपना काम", "बीस किलोमीटर", "पूरा दिन", "दोनों", "हाँ", "नहीं", "औज़ार", "वर्कशॉप", "हाँ", "पहला", "हाँ"]);
    const after = (await store.beneficiaries.get(id))!;
    check("Status only moves forward for the bot", after.status === "certified", after.status);
    check("Officer change is on the timeline", after.timeline.some((t) => t.type === "status" && t.by === "officer"));
    check(
      "Repeat interest does not duplicate the open enrolment task",
      (await tasks.list({ beneficiaryId: id, type: "enrol", status: "open" })).length === 1,
    );
  }

  /* Hand-offs become one callback task, however many times they happen. */
  {
    const id = await person();
    await run(id, ["हाँ", "किसी इंसान से बात कराओ"]);
    let r = startInterview();
    r = await step(r.state, "इंसान से बात");
    await store.applyInterviewEvents(id, r.events, r.state);

    const callbacks = await tasks.list({ beneficiaryId: id, type: "callback" });
    const b = (await store.beneficiaries.get(id))!;

    check("Hand-off: one callback task for the Saathi", callbacks.length === 1 && callbacks[0].owner === "saathi", String(callbacks.length));
    check("Hand-off: flagged on the record", b.flags.includes("handoff"));
  }

  /* The same misunderstood phrase from two people is one row, counted twice. */
  {
    const a = await person();
    const c = await person();
    await run(a, ["हाँ", "झांसी", "बबीना", "दसवीं", "टोकरी बनाते हैं"]);
    await run(c, ["हाँ", "झांसी", "मोठ", "दसवीं", "टोकरी बनाते हैं।"]);

    const words = await unknownWords.list({ slot: "currentWork" });
    check("Unknown words: grouped with a count", words.length === 1 && words[0].count === 2, JSON.stringify(words));
    check("Unknown words: district recorded", words[0]?.districts.includes("jhansi") === true);
  }

  /* A dropped call resumes where it stopped. */
  {
    const id = await person("+910000000002");
    await run(id, ["हाँ", "गया", "बोधगया", "दसवीं", "सिलाई"]);

    const b = (await store.beneficiaries.get(id))!;
    check("Resume: unfinished interview is resumable", canResume(b.interview.stage, b.interview.answered), b.interview.stage);

    const again = resumeInterview({ profile: b.profile, answered: b.interview.answered });
    check("Resume: welcomes back", again.say.startsWith("नमस्ते, फिर से स्वागत है"), again.say);
    check("Resume: asks the next unanswered question", again.state.slot === "familyTrade", again.state.slot);
    check("Resume: keeps earlier answers", again.state.profile.education === 10 && again.state.profile.currentWork === "tailoring");
    check("Resume: found by phone number", (await store.getByPhone("+910000000002"))?.id === id);
  }

  console.log("\nRoutes\n");

  /* Writes through the control plane are validated before they touch a record. */
  {
    const id = await person();
    const replies: { status: number; body: Record<string, unknown> }[] = [];

    const call = async (
      method: string,
      route: string,
      body: Record<string, unknown> = {},
      headers: Record<string, string> = {},
    ) => {
      await handleLivelihoodRoute(
        { method, headers } as never,
        {} as never,
        new URL(`http://x${route}`),
        {
          json: (_res, status, b) => replies.push({ status, body: b as Record<string, unknown> }),
          readJson: async () => body,
        },
      );
      return replies[replies.length - 1];
    };

    check("Route: unknown status refused", (await call("POST", "/internal/beneficiaries/status", { id, status: "promoted", by: "officer" })).status === 400);
    check("Route: unknown actor refused", (await call("POST", "/internal/beneficiaries/status", { id, status: "enrolled", by: "hacker" })).status === 400);
    check("Route: valid status accepted", (await call("POST", "/internal/beneficiaries/status", { id, status: "enrolled", by: "centre" })).status === 200);

    const word = (await unknownWords.list({ slot: "currentWork" }))[0];
    check("Route: mapping to a non-value refused", (await call("POST", "/internal/unknown-words/map", { id: word.id, mappedTo: "basket" })).status === 400);
    check("Route: mapping to a real trade accepted", (await call("POST", "/internal/unknown-words/map", { id: word.id, mappedTo: "weaving" })).status === 200);

    const { extractSlot } = await import("../lib/livelihood/extract");
    check(
      "Learned: a mapped word is understood on the next call",
      extractSlot("currentWork", "हम टोकरी बनाते हैं", {})?.currentWork === "weaving",
    );
    await call("POST", "/internal/unknown-words/map", { id: word.id, mappedTo: null });
    check(
      "Learned: un-mapping forgets it again",
      extractSlot("currentWork", "हम टोकरी बनाते हैं", {})?.currentWork === undefined,
    );

    /* Scope: a Gaya officer cannot see or change a Jhansi record. */
    const jhansi = (await store.beneficiaries.list({ district: "jhansi" }))[0];
    const gayaOfficer = { "x-scope-role": "district", "x-scope-district": "gaya" };
    const jhansiOfficer = { "x-scope-role": "district", "x-scope-district": "jhansi" };
    const centre = { "x-scope-role": "centre", "x-scope-centre": "j2" };

    check("Scope: other district's record is hidden", (await call("GET", `/internal/beneficiaries?id=${jhansi.id}`, {}, gayaOfficer)).status === 404);
    check("Scope: own district's record is visible", (await call("GET", `/internal/beneficiaries?id=${jhansi.id}`, {}, jhansiOfficer)).status === 200);
    check(
      "Scope: list only shows own district",
      ((await call("GET", "/internal/beneficiaries", {}, gayaOfficer)).body.beneficiaries as { district?: string }[]).every((b) => b.district === "gaya"),
    );
    check("Scope: other district cannot change status", (await call("POST", "/internal/beneficiaries/status", { id: jhansi.id, status: "dropped" }, gayaOfficer)).status === 403);
    check("Scope: a centre cannot mark someone placed", (await call("POST", "/internal/beneficiaries/status", { id: jhansi.id, status: "placed" }, centre)).status === 403);
    const asOfficer = await call("POST", "/internal/beneficiaries/note", { id: jhansi.id, note: "visited", by: "bot" }, jhansiOfficer);
    const lastEntry = (asOfficer.body.beneficiary as { timeline: { by: string }[] }).timeline.at(-1);
    check("Scope: writes are recorded as the session's role, not the client's claim", lastEntry?.by === "officer", lastEntry?.by);

    const stats = await call("GET", "/internal/stats");
    const byStatus = stats.body.byStatus as Record<string, number>;
    check("Route: stats count by status", stats.status === 200 && byStatus.enrolled >= 1 && byStatus.certified >= 1, JSON.stringify(byStatus));
    check("Route: open tasks counted", (stats.body.openTasks as number) >= 2, String(stats.body.openTasks));
  }

  console.log(failures === 0 ? "\nAll record checks pass." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
