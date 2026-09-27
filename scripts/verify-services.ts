/**
 * Help desk, follow-up calls, certificates, sign-in, erasure, the completion
 * model and the planning views — end to end on the file store, in a throwaway
 * directory, with no keys and no network. Run: npm run verify:services
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
  delete process.env.MONGODB_URL;
  delete process.env.INTERNAL_TOKEN;
  process.env.OTP_DEV = "1";
  process.chdir(await mkdtemp(path.join(tmpdir(), "kaushal-services-")));

  const store = await import("../lib/store/beneficiaries");
  const { tasks } = await import("../lib/store/tasks");
  const { openConversation, allSaved } = await import("../lib/store/conversations");
  // Wait for background saves to finish — deterministically, not by sleeping.
  const settle = () => allSaved();
  const { handleLivelihoodRoute } = await import("../voice-server/livelihood-routes");
  const { recommend } = await import("../lib/livelihood/recommender");
  const { completionModel } = await import("../lib/ml/model");
  const { kmeans, profileVector } = await import("../lib/ml/kmeans");
  const { rng, syntheticProfile } = await import("../lib/ml/synthetic");
  const { syncAll } = await import("../lib/store/sync");
  const { matchConsultant } = await import("../lib/livelihood/consultants");

  await syncAll();

  const replies: { status: number; body: Record<string, unknown> }[] = [];
  const call = async (method: string, route: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) => {
    await handleLivelihoodRoute({ method, headers } as never, {} as never, new URL(`http://x${route}`), {
      json: (_r, status, b) => replies.push({ status, body: b as Record<string, unknown> }),
      readJson: async () => body,
    });
    return replies[replies.length - 1];
  };

  /** Ramesh, through the interview to "interested", as a phone caller. */
  async function interestedRamesh(phone: string) {
    const { conversation, beneficiary } = await openConversation({ phone, channelId: `call-${phone}` });
    for (const t of [
      "हाँ जी", "मैं बबीना से हूँ", "आठवीं तक पढ़ा हूँ", "पंक्चर की दुकान पर काम करता हूँ", "पापा साइकिल ठीक करते थे",
      "हाँ, आगे बढ़ाना है", "मोटरसाइकिल और इंजन का काम", "अपना काम खोलना है", "बीस किलोमीटर तक", "पूरा दिन",
      "हाथ से करके", "हाँ", "नहीं, कोई दिक्कत नहीं", "औज़ार हैं", "वर्कशॉप खोलना चाहता हूँ", "हाँ सही है", "पहला", "हाँ",
    ]) await conversation.respond(t);
    await settle();
    return beneficiary.id;
  }

  // -------------------------------------------------------------------------
  console.log("Help desk\n");

  const id = await interestedRamesh("+919000000001");
  check("Setup: Ramesh is interested", (await store.beneficiaries.get(id))?.status === "interested");

  {
    const { conversation } = await openConversation({ phone: "+919000000001", channelId: "call-2" });
    const say = (t: string) => conversation.respond(t).then((r) => r.say);

    check("Returning caller gets the help desk", conversation.mode === "helpdesk" && conversation.greeting.includes("दोपहिया सर्विस सहायक"), conversation.greeting);
    check("Duration answered from the catalogue", (await say("यह कोर्स कितने दिन का है")).includes("3 महीने"));
    check("Centre answered from the record", (await say("सेंटर कहाँ है")).includes("Sample PMKVY Centre – Babina"));

    const ticketReply = await say("मेरा स्टाइपेंड नहीं आया");
    const number = ticketReply.match(/नंबर ([A-F0-9]{6})/)?.[1];
    await settle();
    const ticket = (await tasks.list({ beneficiaryId: id, type: "ticket" }))[0];
    check("Complaint becomes a numbered ticket", Boolean(number) && ticket?.id.replace(/-/g, "").slice(0, 6).toUpperCase() === number, ticketReply);
    check("Ticket is categorised and owned by an officer", ticket?.data?.category === "stipend" && ticket.owner === "officer");
    check("Ticket status can be asked about", (await say("मेरी शिकायत का क्या हुआ")).includes(`${number} पर काम चल रहा है`));

    await say("मेरी ट्रेनिंग शुरू हो गई");
    await settle();
    check("Reported training moves the status", (await store.beneficiaries.get(id))?.status === "training");

    await say("सर्टिफिकेट मिल गया");
    await settle();
    check("A spoken 'certified' is not trusted without a document", (await store.beneficiaries.get(id))?.status === "training");
    check("…it opens a verification task instead", (await tasks.list({ beneficiaryId: id, type: "verify" })).length === 1);

    check("Unknown question offers to ask an officer", (await say("बारिश में क्लास होगी क्या")).includes("अधिकारी तक पहुँचा दूँ"));
    const passed = await say("हाँ");
    await settle();
    check("…and 'yes' files it", passed.includes("नंबर") && (await tasks.list({ beneficiaryId: id, type: "ticket" })).length === 2);
  }

  {
    // A model answer is only spoken if every fact in it is the person's own.
    const inventsDate = async () => "आपका स्टाइपेंड 15 तारीख को आ जाएगा।";
    const honest = async () => "आपका कोर्स 90 दिन का है।";

    const a = await openConversation({ phone: "+919000000001", channelId: "call-3", answer: inventsDate });
    const invented = await a.conversation.respond("पैसे वाली बात बताओ ना");
    check("Guard: an invented date is never spoken", !invented.say.includes("15") && invented.say.includes("अधिकारी"), invented.say);

    const b = await openConversation({ phone: "+919000000001", channelId: "call-4", answer: honest });
    const ok = await b.conversation.respond("कोर्स के बारे में बताओ ना");
    check("Guard: a true answer passes", ok.say.startsWith("आपका कोर्स 90 दिन का है"), ok.say);
  }

  {
    const { conversation } = await openConversation({ phone: "+919000000001", channelId: "call-5" });
    const r = await conversation.respond("मुझे नया कोर्स चाहिए");
    check("'New course' restarts the interview without asking consent again", conversation.mode === "interview" && r.say.includes("किस ज़िले"), r.say);
  }

  // -------------------------------------------------------------------------
  console.log("\nCertificates, follow-ups, placement\n");

  {
    const png = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");
    const up = await call("POST", "/internal/beneficiaries/certificate", { id, contentType: "image/png", dataBase64: png }, { "x-scope-role": "beneficiary", "x-scope-beneficiary": id });
    const b = up.body.beneficiary as { status: string; certificate?: { verified: boolean } } | undefined;
    check("Certificate upload moves them to certified", up.status === 200 && b?.status === "certified");
    check("…awaiting an officer's verification", b?.certificate?.verified === false);

    const wrongType = await call("POST", "/internal/beneficiaries/certificate", { id, contentType: "text/html", dataBase64: png });
    check("Only PDF/JPEG/PNG accepted", wrongType.status === 400);

    const v = await call("POST", "/internal/beneficiaries/verify-certificate", { id }, { "x-scope-role": "district", "x-scope-district": "jhansi" });
    check("Officer verifies it", (v.body.beneficiary as { certificate: { verified: boolean } }).certificate.verified === true);

    const fu = await tasks.list({ beneficiaryId: id, type: "follow_up" }, { sortBy: "dueAt" });
    const days = fu.map((t) => Math.round((t.dueAt - Date.now()) / 86400000));
    check("Certification schedules 30- and 90-day follow-ups", fu.length === 2 && days[0] === 30 && days[1] === 90, JSON.stringify(days));

    const placement = await call("GET", "/internal/placement?district=jhansi");
    const employer = (placement.body.employers as { id: string; shortlist: { id: string }[] }[]).find((e) => e.id === "e_j1");
    check("Certified mechanic is shortlisted for the two-wheeler dealer", Boolean(employer?.shortlist.some((s) => s.id === id)));

    const f = await openConversation({ phone: "+919000000001", channelId: "fu-1", purpose: "followup" });
    check("Follow-up call opens with the course", f.conversation.greeting.includes("दोपहिया सर्विस सहायक"));
    await f.conversation.respond("हाँ, अपनी दुकान चलाता हूँ");
    const end = await f.conversation.respond("पंद्रह हज़ार हो जाते हैं");
    await settle();

    const after = (await store.beneficiaries.get(id))!;
    const entry = after.timeline.find((t) => t.type === "followup");
    check("Follow-up: working in own business", after.status === "self_employed" && end.end, after.status);
    check("Follow-up: income recorded", entry?.data?.monthlyIncome === 15000, JSON.stringify(entry?.data));
    check("Follow-up: the 30-day task is closed", (await tasks.list({ beneficiaryId: id, type: "follow_up", status: "open" })).length === 1);
  }

  // -------------------------------------------------------------------------
  console.log("\nSign-in and erasure\n");

  {
    const req = await call("POST", "/internal/otp/request", { phone: "90000 00001" });
    const code = req.body.devCode as string;
    check("OTP: code issued (dev mode shows it)", req.status === 200 && /^\d{6}$/.test(code));
    check("OTP: asking again at once is refused", (await call("POST", "/internal/otp/request", { phone: "9000000001" })).status === 429);
    check("OTP: wrong code refused", (await call("POST", "/internal/otp/verify", { phone: "9000000001", code: "000000" })).status === 401);
    const ok = await call("POST", "/internal/otp/verify", { phone: "9000000001", code });
    check("OTP: right code signs in to their own record", ok.status === 200 && ok.body.beneficiaryId === id);
    check("OTP: a used code cannot be replayed", (await call("POST", "/internal/otp/verify", { phone: "9000000001", code })).status === 401);

    const other = await interestedRamesh("+919000000009");
    const me = { "x-scope-role": "beneficiary", "x-scope-beneficiary": id };
    check("A beneficiary cannot read someone else's record", (await call("GET", `/internal/beneficiaries?id=${other}`, {}, me)).status === 404);

    const sidh = await call("GET", `/internal/sidh?id=${id}`, {}, me);
    check("SIDH connector is clearly marked as demo data", (sidh.body.sidh as { mock: boolean }).mock === true);

    const del = await call("POST", "/internal/beneficiaries/delete", { id: other }, { "x-scope-role": "beneficiary", "x-scope-beneficiary": other });
    check("Erasure: record gone", del.status === 200 && (await store.beneficiaries.get(other)) === null);
    check("Erasure: their tasks gone too", (await tasks.list({ beneficiaryId: other })).length === 0);
  }

  // -------------------------------------------------------------------------
  console.log("\nModel and planning\n");

  {
    const model = completionModel();
    check("Completion model is loaded", Boolean(model), "run npm run ml:train");
    check("Model beats rules-only on held-out data", Boolean(model && model.metrics.auc > model.metrics.baselineAuc), JSON.stringify(model?.metrics));

    const base = {
      district: "gaya", block: "Bodh Gaya", language: "hi" as const, education: 10, interestSectors: ["automotive", "beauty"] as never,
      skills: [], preference: "either" as const, maxTravelKm: 40, canRelocate: false, constraints: [], assets: [], gender: "female" as const,
    };
    const busy = recommend({ ...base, hoursPerDay: 2, familySupport: true });
    const rank = (id: string) => [...busy.picks, ...busy.more].findIndex((r) => r.course.id === id);
    check(
      "Little free time: nearby part-time course ranks above a farther full-time one",
      rank("c_beauty_asst") < rank("c_2w_service"),
      `${rank("c_beauty_asst")} vs ${rank("c_2w_service")}`,
    );
    check(
      "Every model score comes with its reasons",
      busy.picks.every((p) => p.completion && p.completion.factors.length > 0),
      JSON.stringify(busy.picks.map((p) => p.completion)),
    );

    const rand = rng(3);
    const clusters = kmeans(Array.from({ length: 300 }, () => profileVector(syntheticProfile(rand))), 4);
    check("Clustering: four labelled groups", clusters.length === 4 && clusters.every((c) => c.label.hi.length > 0));

    const insights = await call("GET", "/internal/insights?district=jhansi");
    const gaps = insights.body.skillGaps as { skill: string }[];
    check("Insights: district skill gaps listed", insights.status === 200 && gaps.some((g) => g.skill === "engine_basics"), JSON.stringify(gaps));
    check("Insights: consultant coverage per block", (insights.body.consultantCoverage as unknown[]).length === 4);

    const plan = await call("GET", "/internal/plan?district=jhansi");
    check("Perspective plan exports as CSV", String(plan.body.csv).startsWith("block,sector,course,interested_people,batches_needed"));
  }

  {
    // A newly registered consultant is only matched once verified.
    const moth = {
      district: "jhansi", block: "Moth", language: "hi" as const, education: 0, familyTrade: "pottery", continueFamilyTrade: true,
      interestSectors: ["handicrafts"] as never, skills: [], preference: "self" as const, maxTravelKm: 20, canRelocate: false, constraints: [], assets: [],
    };
    const officer = { "x-scope-role": "district", "x-scope-district": "jhansi" };

    const reg = await call("POST", "/internal/consultants", { name: "New Moth Consultant", blocks: ["Moth"], specialisations: ["dpr"] }, officer);
    const newId = (reg.body.consultant as { id: string }).id;
    check("Registered consultant starts unverified", (reg.body.consultant as { verified: boolean }).verified === false);
    check("…and is not matched", matchConsultant(moth as never)?.id !== newId);

    await call("POST", "/internal/consultants/verify", { id: newId }, officer);
    check("Once verified, the block's own consultant is matched", matchConsultant(moth as never)?.id === newId, matchConsultant(moth as never)?.id);

    const saathi = { "x-scope-role": "saathi", "x-scope-district": "jhansi" };
    check("A Saathi cannot register consultants", (await call("POST", "/internal/consultants", { name: "x" }, saathi)).status === 403);
  }

  // -------------------------------------------------------------------------
  console.log("\nDistrict knowledge\n");

  {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const region = await import("../lib/rag/region");
    const { validateCards } = await import("../lib/livelihood/opportunity-extract");

    // Test-only passages, written here and never shipped as data.
    const chunks = [
      { id: "jhansi/t.md#1", text: "TEST PASSAGE: There is scope for dairy units and milk collection centres in Moth block, with an investment of 50000 to 200000 rupees.", state: "Uttar Pradesh", district: "jhansi", sourceType: "dips", document: "dips_test.md", page: 4 },
      { id: "nashik/t.md#1", text: "TEST PASSAGE: Dairy and milk processing is strong in Niphad.", state: "Maharashtra", district: "nashik", sourceType: "dips", document: "dips_test.md", page: 2 },
    ];
    await mkdir(path.dirname(region.REGION_STORE_PATH), { recursive: true });
    await writeFile(region.REGION_STORE_PATH, JSON.stringify({ createdAt: Date.now(), chunks }));
    region.invalidateRegion();

    const hits = await region.searchRegion("dairy milk units", "jhansi");
    check("Region search stays inside the district", hits.length === 1 && hits[0].district === "jhansi", JSON.stringify(hits.map((h) => h.district)));
    check("PDF pages split on form feeds", region.splitPages("one\ftwo\f\f").map((p) => p.page).join() === "1,2");
    check("Source type from file name", region.sourceTypeOf("plp_jhansi_2024.pdf") === "plp" && region.sourceTypeOf("notes.pdf") === "other");

    const { cards, rejected } = validateCards(
      {
        cards: [
          { chunkId: "jhansi/t.md#1", sector: "dairy_livestock", kind: "enterprise", idea: "Milk collection centre", ideaHi: "दूध संग्रह केंद्र", evidence: "scope for dairy units and milk collection centres", capitalMin: 50000, capitalMax: 200000 },
          { chunkId: "jhansi/t.md#1", sector: "dairy_livestock", idea: "Cheese factory", ideaHi: "पनीर फैक्ट्री", evidence: "huge demand for cheese factories" },
          { chunkId: "jhansi/t.md#1", sector: "space_travel", idea: "x", ideaHi: "x", evidence: "scope for dairy units and milk collection centres" },
          { chunkId: "jhansi/t.md#1", sector: "dairy_livestock", idea: "Dairy", ideaHi: "डेयरी", evidence: "scope for dairy units and milk collection centres", capitalMin: 999, capitalMax: 5000000 },
        ],
      },
      chunks,
    );
    check("Cards: a quoted card is kept with its page", cards[0]?.source.page === 4 && cards[0].capitalRange?.[1] === 200000);
    check("Cards: an unquoted claim is dropped", !cards.some((c) => c.idea === "Cheese factory"));
    check("Cards: an unknown sector is dropped", rejected === 2, String(rejected));
    check("Cards: amounts not in the text are not kept", cards[1] && cards[1].capitalRange === undefined);

    const { setOpportunities } = await import("../lib/livelihood/opportunities");
    setOpportunities(cards);
    const dairy = recommend({
      district: "jhansi", block: "Moth", language: "hi", education: 5, familyTrade: "dairy", continueFamilyTrade: true,
      interestSectors: ["dairy_livestock"], skills: [], preference: "self", maxTravelKm: 20, canRelocate: false, constraints: [], assets: ["livestock"],
    });
    check("Cards reach the recommendation for that district and sector", dairy.picks[0]?.opportunities[0]?.ideaHi === "दूध संग्रह केंद्र", JSON.stringify(dairy.picks[0]?.opportunities));
  }

  // -------------------------------------------------------------------------
  console.log("\nBrowser voice (text chat) identity\n");

  {
    const { createToken } = await import("../lib/auth/session");
    const someone = await interestedRamesh("+919000000077");

    const ticket = createToken({ kind: "call", beneficiaryId: someone, exp: Date.now() + 60000 });
    const opened = await call("POST", "/internal/chat", { ticket });
    check("A call ticket opens the chat as that person", opened.body.beneficiaryId === someone && opened.body.mode === "helpdesk", JSON.stringify(opened.body).slice(0, 120));
    check("The reply says which language to speak in", opened.body.language === "hi");

    const forged = await call("POST", "/internal/chat", { ticket: "not-a-real-ticket" });
    check("A forged ticket is ignored (fresh, anonymous chat)", forged.body.beneficiaryId !== someone && forged.body.mode === "interview");

    const expired = createToken({ kind: "call", beneficiaryId: someone, exp: Date.now() - 1 });
    check("An expired ticket is ignored", (await call("POST", "/internal/chat", { ticket: expired })).body.beneficiaryId !== someone);
  }

  // -------------------------------------------------------------------------
  console.log("\nWebsite translation\n");

  {
    const { LANGUAGES } = await import("../lib/i18n/languages");
    const { translate, setTranslator } = await import("../lib/i18n/translate");

    const offered = LANGUAGES.map((l) => l.code).sort().join();
    check("The six project languages offered", offered === "as,bn,en,hi,kok,te", offered);

    let calls = 0;
    let seen: string[] = [];
    setTranslator("stub", async (texts, target) => {
      calls++;
      seen = texts;
      return texts.map((t) => `[${target}] ${t}`);
    });

    const first = await translate(["बात शुरू करें", "मेरी प्रगति"], "te", "hi");
    check("Translates into the chosen language", first.translations[0] === "[te] बात शुरू करें" && first.provider === "stub");

    const again = await translate(["बात शुरू करें", "सहायता"], "te", "hi");
    check("Cached sentences are not paid for twice", calls === 2 && seen.length === 1 && seen[0] === "सहायता" && again.cached === 1, JSON.stringify({ calls, seen }));
    check("Same text, other language, is its own entry", (await translate(["बात शुरू करें"], "bn", "hi")).translations[0] === "[bn] बात शुरू करें");
    check("Source language is returned as is", (await translate(["नमस्ते"], "hi", "hi")).translations[0] === "नमस्ते");
    check("Unknown language refused", Boolean((await translate(["x"], "xx", "hi")).error));

    setTranslator("broken", async () => {
      throw new Error("provider down");
    });
    const down = await translate(["यह नया वाक्य है"], "as", "hi");
    check("Provider down: originals come back, with the reason", down.translations[0] === "यह नया वाक्य है" && down.error === "provider down");

    setTranslator("stub", undefined);
    const route = await call("POST", "/internal/translate", { texts: [], target: "ta" });
    check("Translate route validates its input", route.status === 400);
  }

  console.log(failures === 0 ? "\nAll service checks pass." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
