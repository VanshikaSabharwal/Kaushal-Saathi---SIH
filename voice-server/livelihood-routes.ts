/**
 * Control-plane routes for the livelihood records.
 *
 * Served by the voice server for the same reason call records are: it is the
 * one process with a durable filesystem and the one writing interview results,
 * so keeping every write here means one writer whatever the storage backend.
 * The Next API routes proxy to these, attaching the caller's scope.
 *
 * Every read is filtered by scope and every write is validated twice: against
 * the known values (a status that does not exist cannot be set) and against
 * the role (a centre cannot mark someone placed; a district officer cannot see
 * another district).
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { MockSidhConnector } from "../lib/integrations/sidh";
import { groqAnswerer } from "../lib/livelihood/answer";
import { getCourse } from "../lib/livelihood/catalog";
import type { Conversation } from "../lib/livelihood/conversation";
import { allowedValues } from "../lib/livelihood/extract";
import { setLearned } from "../lib/livelihood/learned";
import { groqExtractor } from "../lib/livelihood/llm-extract";
import {
  addNote,
  beneficiaries,
  getByPhone,
  newBeneficiary,
  setStatus,
  STATUSES,
  type Beneficiary,
  type BeneficiaryStatus,
} from "../lib/store/beneficiaries";
import { openConversation, whenSaved } from "../lib/store/conversations";
import { conversationOf, eraseMessages } from "../lib/store/messages";
import { normalizePhone, requestOtp, verifyOtp } from "../lib/store/otp";
import {
  actorOf,
  authorised,
  canSee,
  canSeeTask,
  canSetStatus,
  canTeachWords,
  scopeFrom,
  type Scope,
} from "../lib/store/scope";
import { openTask, setTaskStatus, tasks, type Actor, type TaskStatus } from "../lib/store/tasks";
import { loadLearned, mapUnknown, unknownWords, type UnknownWord } from "../lib/store/unknown-words";
import { login } from "../lib/store/users";
import { readToken } from "../lib/auth/session";
import { MAX_TEXTS, translate } from "../lib/i18n/translate";
import { handleInsightsRoute } from "./insights-routes";

type Helpers = {
  json: (res: ServerResponse, status: number, body: unknown) => void;
  readJson: (req: IncomingMessage) => Promise<Record<string, unknown>>;
};

const ACTORS: Actor[] = ["bot", "beneficiary", "saathi", "officer", "centre", "consultant"];
const ALL_STATUSES: BeneficiaryStatus[] = [...STATUSES, "dropped"];
const TASK_STATUSES: TaskStatus[] = ["open", "done", "cancelled"];

const UPLOAD_DIR = path.join(process.cwd(), ".data", "uploads");
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const UPLOAD_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const param = (url: URL, k: string) => url.searchParams.get(k) ?? undefined;
const limitOf = (url: URL, fallback: number) =>
  Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? fallback) || fallback));

// ---------------------------------------------------------------------------
// Text chat sessions
// ---------------------------------------------------------------------------

/**
 * Open text conversations, in memory. A chat is short-lived and resumable from
 * the record anyway, so losing these on restart costs a greeting, not data.
 */
const chats = new Map<string, { conversation: Conversation; beneficiaryId: string; lastAt: number }>();
const CHAT_IDLE_MS = 30 * 60 * 1000;

setInterval(() => {
  const cutoff = Date.now() - CHAT_IDLE_MS;
  for (const [id, c] of chats) if (c.lastAt < cutoff) chats.delete(id);
}, 5 * 60 * 1000).unref();

const sidh = new MockSidhConnector();

// ---------------------------------------------------------------------------

/** The actor a write is recorded as: from the session, never from the client. */
function writer(scope: Scope, claimed: unknown): Actor | undefined {
  if (scope.role === "internal") {
    const by = str(claimed) as Actor | undefined;
    return by && ACTORS.includes(by) ? by : undefined;
  }
  return actorOf(scope);
}

async function visible(scope: Scope, id: string | undefined): Promise<Beneficiary | null> {
  if (!id) return null;
  const b = await beneficiaries.get(id);
  return b && canSee(scope, b) ? b : null;
}

/** Returns true when the request was one of ours and has been answered. */
export async function handleLivelihoodRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  helpers: Helpers,
): Promise<boolean> {
  const { json, readJson } = helpers;
  const route = `${req.method} ${url.pathname}`;

  if (!url.pathname.startsWith("/internal/")) return false;

  if (!authorised(req)) {
    json(res, 401, { error: "Missing or wrong internal token." });
    return true;
  }

  const scope = scopeFrom(req);

  switch (route) {
    // -- Beneficiaries ------------------------------------------------------

    case "GET /internal/beneficiaries": {
      const id = param(url, "id");

      if (id) {
        const b = await visible(scope, id);
        if (!b) {
          json(res, 404, { error: "No such beneficiary." });
          return true;
        }

        // Their complaints with current status, so "मेरी प्रगति" can show them.
        const tickets = (await tasks.list({ beneficiaryId: b.id, type: "ticket" }, { sortBy: "createdAt", desc: true })).map((t) => ({
          id: t.id,
          status: t.status,
          category: t.data?.category,
          text: t.data?.text,
          createdAt: t.createdAt,
          dueAt: t.dueAt,
        }));

        json(res, 200, { beneficiary: b, tickets });
        return true;
      }

      const list = await beneficiaries.list(
        {
          district: param(url, "district"),
          block: param(url, "block"),
          status: param(url, "status") as BeneficiaryStatus | undefined,
        } as Partial<Beneficiary>,
        { sortBy: "updatedAt", desc: true, limit: 5000 },
      );

      json(res, 200, { beneficiaries: list.filter((b) => canSee(scope, b)).slice(0, limitOf(url, 100)) });
      return true;
    }

    case "POST /internal/beneficiaries": {
      // Quick registration by a Saathi, before handing over the phone.
      const body = await readJson(req);
      const phone = normalizePhone(str(body.phone) ?? "");

      if (!phone) {
        json(res, 400, { error: "Need a 10-digit phone number." });
        return true;
      }

      const existing = await getByPhone(phone);
      if (existing) {
        json(res, 200, { beneficiary: existing, existing: true });
        return true;
      }

      const b = newBeneficiary({ phone });
      b.profile = {
        ...(str(body.district) ? { district: str(body.district) } : {}),
        ...(str(body.block) ? { block: str(body.block) } : {}),
      };
      b.district = str(body.district) ?? scope.district;
      b.block = str(body.block);
      b.timeline.push({ at: Date.now(), type: "registered", by: writer(scope, "saathi") ?? "saathi", note: str(body.name) });

      await beneficiaries.upsert(b);
      json(res, 200, { beneficiary: b, existing: false });
      return true;
    }

    case "POST /internal/beneficiaries/status": {
      const body = await readJson(req);
      const id = str(body.id);
      const status = str(body.status) as BeneficiaryStatus | undefined;
      const by = writer(scope, body.by);

      if (!id || !status || !ALL_STATUSES.includes(status) || !by) {
        json(res, 400, { error: `Need id, status (${ALL_STATUSES.join("|")}) and by (${ACTORS.join("|")}).` });
        return true;
      }

      if (!canSetStatus(scope, status) || !(await visible(scope, id))) {
        json(res, 403, { error: "Not allowed to set this status for this person." });
        return true;
      }

      const b = await setStatus(id, status, by, str(body.note));
      json(res, b ? 200 : 404, b ? { beneficiary: b } : { error: "No such beneficiary." });
      return true;
    }

    case "POST /internal/beneficiaries/note": {
      const body = await readJson(req);
      const id = str(body.id);
      const by = writer(scope, body.by);
      const note = str(body.note);

      if (!id || !note || !by) {
        json(res, 400, { error: "Need id, note and by." });
        return true;
      }

      if (!(await visible(scope, id))) {
        json(res, 404, { error: "No such beneficiary." });
        return true;
      }

      const b = await addNote(id, by, note);
      json(res, b ? 200 : 404, b ? { beneficiary: b } : { error: "No such beneficiary." });
      return true;
    }

    case "POST /internal/beneficiaries/certificate": {
      const body = await readJson(req);
      const b = await visible(scope, str(body.id));
      const contentType = str(body.contentType) ?? "";
      const data = str(body.dataBase64);

      if (!b || !data || !UPLOAD_TYPES.has(contentType)) {
        json(res, 400, { error: "Need id, a PDF/JPEG/PNG contentType and dataBase64." });
        return true;
      }

      const bytes = Buffer.from(data, "base64");
      if (bytes.length > MAX_UPLOAD_BYTES) {
        json(res, 413, { error: "Certificate must be under 5 MB." });
        return true;
      }

      const ext = contentType === "application/pdf" ? "pdf" : contentType === "image/png" ? "png" : "jpg";
      const file = `${Date.now()}.${ext}`;
      await mkdir(path.join(UPLOAD_DIR, b.id), { recursive: true });
      await writeFile(path.join(UPLOAD_DIR, b.id, file), bytes);

      await beneficiaries.update(b.id, (d) =>
        d ? { ...d, certificate: { file, contentType, uploadedAt: Date.now(), verified: false } } : null,
      );

      // Uploading moves them to certified; an officer confirms the document.
      const updated = await setStatus(b.id, "certified", writer(scope, "beneficiary") ?? "beneficiary", "certificate uploaded");
      await openTask({ type: "verify", beneficiaryId: b.id, reason: "certificate uploaded — verify", district: b.district, block: b.block });

      json(res, 200, { beneficiary: updated });
      return true;
    }

    case "GET /internal/beneficiaries/certificate": {
      const b = await visible(scope, param(url, "id"));

      if (!b?.certificate) {
        json(res, 404, { error: "No certificate." });
        return true;
      }

      const bytes = await readFile(path.join(UPLOAD_DIR, b.id, b.certificate.file));
      json(res, 200, { contentType: b.certificate.contentType, dataBase64: bytes.toString("base64") });
      return true;
    }

    case "POST /internal/beneficiaries/verify-certificate": {
      const body = await readJson(req);
      const b = await visible(scope, str(body.id));

      if (!b?.certificate || !canSetStatus(scope, "certified") || scope.role === "centre") {
        json(res, 403, { error: "Only an officer can verify a certificate." });
        return true;
      }

      const updated = await beneficiaries.update(b.id, (d) =>
        d?.certificate
          ? {
              ...d,
              certificate: { ...d.certificate, verified: true },
              timeline: [...d.timeline, { at: Date.now(), type: "certificate_verified", by: writer(scope, "officer") ?? "officer" }],
            }
          : d,
      );
      const verify = (await tasks.list({ beneficiaryId: b.id, type: "verify", status: "open" }))[0];
      if (verify) await setTaskStatus(verify.id, "done");

      json(res, 200, { beneficiary: updated });
      return true;
    }

    case "POST /internal/beneficiaries/delete": {
      // The person's right to erasure (DPDP Act): record, tasks and files.
      const body = await readJson(req);
      const b = await visible(scope, str(body.id));

      if (!b || !["beneficiary", "internal", "ministry", "state", "district"].includes(scope.role)) {
        json(res, 404, { error: "No such beneficiary." });
        return true;
      }

      // Let any save from a call or chat still in flight land first; otherwise
      // it could recreate tasks for a person who has just been erased.
      await whenSaved(b.id);

      for (const t of await tasks.list({ beneficiaryId: b.id }, { limit: 5000 })) await tasks.remove(t.id);
      await rm(path.join(UPLOAD_DIR, b.id), { recursive: true, force: true });
      await eraseMessages(b.id);
      await beneficiaries.remove(b.id);

      json(res, 200, { deleted: true });
      return true;
    }

    case "GET /internal/messages": {
      // A person's conversation: their own, or anyone in a staff member's scope.
      const b = await visible(scope, param(url, "id"));
      if (!b) {
        json(res, 404, { error: "No such beneficiary." });
        return true;
      }
      json(res, 200, { messages: await conversationOf(b.id) });
      return true;
    }

    case "GET /internal/sidh": {
      const b = await visible(scope, param(url, "id"));

      if (!b) {
        json(res, 404, { error: "No such beneficiary." });
        return true;
      }

      json(res, 200, {
        sidh: await sidh.learnerRecord({
          phone: b.phone,
          courseName: b.chosen ? getCourse(b.chosen.courseId)?.name : undefined,
          status: b.status,
        }),
      });
      return true;
    }

    // -- Tasks --------------------------------------------------------------

    case "GET /internal/tasks": {
      const list = await tasks.list(
        {
          status: (param(url, "status") ?? "open") as TaskStatus,
          district: param(url, "district"),
          type: param(url, "type"),
          beneficiaryId: param(url, "beneficiaryId"),
        } as Partial<import("../lib/store/tasks").Task>,
        // Most overdue first: the queue is worked from the top.
        { sortBy: "dueAt", limit: 5000 },
      );

      json(res, 200, { tasks: list.filter((t) => canSeeTask(scope, t)).slice(0, limitOf(url, 200)) });
      return true;
    }

    case "POST /internal/tasks/status": {
      const body = await readJson(req);
      const id = str(body.id);
      const status = str(body.status) as TaskStatus | undefined;

      if (!id || !status || !TASK_STATUSES.includes(status)) {
        json(res, 400, { error: `Need id and status (${TASK_STATUSES.join("|")}).` });
        return true;
      }

      const task = await tasks.get(id);
      if (!task || !canSeeTask(scope, task) || scope.role === "beneficiary") {
        json(res, 404, { error: "No such task." });
        return true;
      }

      const t = await setTaskStatus(id, status);
      json(res, 200, { task: t });
      return true;
    }

    // -- Unknown words ------------------------------------------------------

    case "GET /internal/unknown-words": {
      const list = await unknownWords.list(
        { status: (param(url, "status") ?? "new") as UnknownWord["status"], slot: param(url, "slot") } as Partial<UnknownWord>,
        // The most frequent misses are the most valuable to fix.
        { sortBy: "count", desc: true, limit: 2000 },
      );

      const district = scope.role === "district" || scope.role === "saathi" ? scope.district : undefined;
      const mine = district ? list.filter((w) => w.districts.includes(district)) : list;

      json(res, 200, { words: canTeachWords(scope) ? mine.slice(0, limitOf(url, 200)) : [] });
      return true;
    }

    case "POST /internal/unknown-words/map": {
      const body = await readJson(req);
      const id = str(body.id);
      const mappedTo = body.mappedTo === null ? null : str(body.mappedTo);

      if (!canTeachWords(scope)) {
        json(res, 403, { error: "Not allowed." });
        return true;
      }

      if (!id || mappedTo === undefined) {
        json(res, 400, { error: "Need id and mappedTo (a slot value, or null to ignore)." });
        return true;
      }

      if (mappedTo !== null) {
        const word = await unknownWords.get(id);
        const allowed = word ? allowedValues(word.slot) : [];

        // Only real slot values: a free-typed mapping would teach the
        // dictionary something the recommender cannot use.
        if (!word || !Array.isArray(allowed) || !allowed.includes(mappedTo)) {
          json(res, 400, {
            error: word
              ? `mappedTo must be one of: ${Array.isArray(allowed) ? allowed.join(", ") : "(not mappable)"}`
              : "No such word.",
          });
          return true;
        }
      }

      const w = await mapUnknown(id, mappedTo);

      // The very next call understands it — no restart, no deploy.
      if (w) setLearned(await loadLearned());

      json(res, w ? 200 : 404, w ? { word: w } : { error: "No such word." });
      return true;
    }

    // -- Text chat ----------------------------------------------------------

    case "POST /internal/chat": {
      const body = await readJson(req);
      const text = str(body.text);
      let sessionId = str(body.sessionId);
      let chat = sessionId ? chats.get(sessionId) : undefined;

      if (!chat) {
        // A signed-in beneficiary chats as themselves; a signed call ticket (a
        // Saathi handing over the phone) opens as that person; anyone else
        // starts fresh. A bare id from the client is never trusted.
        const ticket = readToken(str(body.ticket));
        sessionId = randomUUID();
        const opened = await openConversation({
          beneficiaryId:
            ticket?.kind === "call"
              ? ticket.beneficiaryId
              : scope.role === "beneficiary"
                ? scope.beneficiaryId
                : undefined,
          language: body.language === "mr" ? "mr" : "hi",
          channelId: `chat-${sessionId}`,
          llm: groqExtractor(),
          answer: groqAnswerer(),
        });

        chat = { conversation: opened.conversation, beneficiaryId: opened.beneficiary.id, lastAt: Date.now() };
        chats.set(sessionId, chat);

        if (!text) {
          json(res, 200, {
            sessionId,
            beneficiaryId: chat.beneficiaryId,
            reply: chat.conversation.greeting,
            end: false,
            mode: chat.conversation.mode,
            language: chat.conversation.language,
          });
          return true;
        }
      }

      if (!text) {
        json(res, 400, { error: "Need text." });
        return true;
      }

      chat.lastAt = Date.now();
      const r = await chat.conversation.respond(text.slice(0, 500));
      if (r.end) chats.delete(sessionId!);

      json(res, 200, {
        sessionId,
        beneficiaryId: chat.beneficiaryId,
        reply: r.say,
        end: r.end,
        mode: chat.conversation.mode,
        // The reply's language — a browser voice speaks and listens in it.
        language: chat.conversation.language,
      });
      return true;
    }

    // -- Translation --------------------------------------------------------

    case "POST /internal/translate": {
      // Website text into any of the 22 Eighth Schedule languages. Public by
      // design (anyone may read the site in their language); bounded per call.
      const body = await readJson(req);
      const texts = Array.isArray(body.texts) ? body.texts.filter((t): t is string => typeof t === "string") : [];
      const target = str(body.target);
      const source = str(body.source) ?? "hi";

      if (!target || texts.length === 0 || texts.length > MAX_TEXTS) {
        json(res, 400, { error: `Need target and 1–${MAX_TEXTS} texts.` });
        return true;
      }

      json(res, 200, await translate(texts, target, source));
      return true;
    }

    // -- Sign-in ------------------------------------------------------------

    case "POST /internal/otp/request": {
      const body = await readJson(req);
      const phone = normalizePhone(str(body.phone) ?? "");

      if (!phone) {
        json(res, 400, { error: "Need a 10-digit phone number." });
        return true;
      }

      const r = await requestOtp(phone);
      json(res, r.ok ? 200 : 429, r);
      return true;
    }

    case "POST /internal/otp/verify": {
      const body = await readJson(req);
      const phone = normalizePhone(str(body.phone) ?? "");
      const code = str(body.code);

      if (!phone || !code || !(await verifyOtp(phone, code))) {
        json(res, 401, { error: "Wrong or expired code." });
        return true;
      }

      // First sign-in without a call yet still gets a record to chat from.
      let b = await getByPhone(phone);
      if (!b) {
        b = newBeneficiary({ phone });
        await beneficiaries.upsert(b);
      }

      json(res, 200, { beneficiaryId: b.id, phone });
      return true;
    }

    case "POST /internal/auth/login": {
      const body = await readJson(req);
      const user = await login(str(body.username) ?? "", typeof body.password === "string" ? body.password : "");
      json(res, user ? 200 : 401, user ? { user } : { error: "Wrong username or password." });
      return true;
    }
  }

  return handleInsightsRoute(req, res, url, scope, helpers);
}
