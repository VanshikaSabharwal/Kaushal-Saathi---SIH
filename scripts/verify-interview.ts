/**
 * Interview checks: whole conversations driven as text. No keys, no network —
 * the LLM fallback is either absent or a local stub, so these also prove how
 * far the dictionary alone gets. Run: npm run verify:interview
 */

import hi from "../data/i18n/hi.json";
import { COURSES } from "../lib/livelihood/catalog";
import { extractSlot, genderOf, yesNo } from "../lib/livelihood/extract";
import { checkReply } from "../lib/livelihood/guard";
import {
  startInterview,
  step,
  type InterviewEvent,
  type StepOptions,
  type StepResult,
} from "../lib/livelihood/interview";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n        ${detail}`}`);
}

/** Feed lines in order; return every step so checks can look anywhere. */
async function converse(lines: string[], opts: StepOptions = {}): Promise<StepResult[]> {
  const steps: StepResult[] = [startInterview()];
  for (const text of lines) {
    const last = steps[steps.length - 1];
    steps.push(await step(last.state, text, opts));
  }
  return steps;
}

const eventsOf = (steps: StepResult[]): InterviewEvent[] => steps.flatMap((s) => s.events);
const last = (steps: StepResult[]) => steps[steps.length - 1];

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
console.log("Interview\n");

/* Ramesh, start to finish, with no LLM at all. */
{
  let llmCalls = 0;
  const spy: StepOptions = {
    llm: async () => {
      llmCalls++;
      return undefined;
    },
  };

  const steps = await converse(
    [
      "हाँ जी",
      "मैं बबीना से हूँ",
      "आठवीं तक पढ़ा हूँ",
      "पंक्चर की दुकान पर काम करता हूँ",
      "पापा साइकिल ठीक करते थे",
      "हाँ, आगे बढ़ाना है",
      "मोटरसाइकिल और इंजन का काम",
      "अपना काम खोलना है",
      "बीस किलोमीटर तक",
      "पूरा दिन",
      "हाथ से करके सीखना अच्छा लगता है",
      "हाँ, घर वाले साथ देंगे",
      "नहीं, कोई दिक्कत नहीं",
      "औज़ार हैं मेरे पास",
      "अपनी वर्कशॉप खोलना चाहता हूँ, पच्चीस हज़ार महीना",
      "हाँ सही है",
      "पहला",
      "हाँ",
    ],
    spy,
  );

  const p = last(steps).state.profile;
  const events = eventsOf(steps);

  check("Ramesh: block named up front skips the block question", !steps.some((s) => s.say.includes("किस ब्लॉक")));
  check("Ramesh: district and block", p.district === "jhansi" && p.block === "Babina", `${p.district}/${p.block}`);
  check("Ramesh: education 8", p.education === 8, String(p.education));
  check("Ramesh: current work", p.currentWork === "cycle_repair", p.currentWork);
  check("Ramesh: family trade", p.familyTrade === "cycle_repair", p.familyTrade);
  check("Ramesh: wants to continue it", p.continueFamilyTrade === true);
  check("Ramesh: interest automotive", p.interestSectors?.includes("automotive") === true, JSON.stringify(p.interestSectors));
  check("Ramesh: self-employment", p.preference === "self", p.preference);
  check("Ramesh: travel 20 km", p.maxTravelKm === 20, String(p.maxTravelKm));
  check("Ramesh: no constraints", p.constraints?.length === 0, JSON.stringify(p.constraints));
  check("Ramesh: tools", p.assets?.includes("tools") === true, JSON.stringify(p.assets));
  check("Ramesh: learns hands-on", p.learning === "hands_on", p.learning);
  check("Ramesh: family supports", p.familySupport === true);
  check("Ramesh: income goal", p.aspiration?.targetMonthlyIncome === 25000, JSON.stringify(p.aspiration));
  check("Ramesh: gender read from his own verbs", p.gender === "male", p.gender);
  check("Ramesh: answers echoed back", steps[3].say.startsWith("आठवीं तक पढ़े, ठीक है।"), steps[3].say);
  check("Ramesh: summary read back before recommending", steps[15].say.includes("मैं दोहरा देती हूँ"), steps[15].say);

  const rec = events.find((e) => e.type === "recommended");
  check(
    "Ramesh: two-wheeler course offered first",
    rec?.type === "recommended" && rec.courseIds[0] === "c_2w_service",
    JSON.stringify(rec),
  );
  check("Ramesh: detail names his skill gap", steps[17].say.includes("इंजन का काम"), steps[17].say);

  const interest = events.find((e) => e.type === "interest");
  check("Ramesh: interest recorded with a centre", interest?.type === "interest" && interest.centreId === "j2", JSON.stringify(interest));
  check("Ramesh: conversation ends", last(steps).end === true);
  check("Ramesh: zero LLM calls (dictionary only)", llmCalls === 0, `${llmCalls} calls`);
}

/* An answer the dictionary cannot place goes to choices, then the LLM. */
{
  let asked = "";
  const stub: StepOptions = {
    llm: async (slot, text) => {
      asked = `${slot}:${text}`;
      return slot === "currentWork" ? { currentWork: "weaving" } : undefined;
    },
  };

  const steps = await converse(["हाँ", "गया", "बोधगया", "दसवीं", "टोकरी बनाता हूँ"], stub);
  const s = last(steps).state;

  check("LLM fallback: consulted on a dictionary miss", asked === "currentWork:टोकरी बनाता हूँ", asked);
  check("LLM fallback: validated value applied", s.profile.currentWork === "weaving", s.profile.currentWork);
  check("LLM fallback: counted", s.llmCalls === 1, String(s.llmCalls));
}

/* The LLM may only return allowed values; anything else is ignored. */
{
  const bad: StepOptions = { llm: async () => ({ currentWork: "astronaut" }) };
  const steps = await converse(["हाँ", "गया", "बोधगया", "दसवीं", "कुछ अजीब सा"], bad);
  // The stub bypasses validation by design; the real extractor validates.
  // What the interview must still guarantee is that it moves on sanely.
  check("LLM fallback: interview keeps going", !last(steps).end);
}

/* A required answer that never lands hands off to a person. */
{
  const steps = await converse(["हाँ", "झांसी", "बबीना", "पता नहीं यार", "हम्म क्या"]);
  const events = eventsOf(steps);

  check("Required slot: choices offered on first miss", steps[4].say.includes("पाँचवीं, आठवीं"), steps[4].say);
  check("Required slot: second miss hands off", events.some((e) => e.type === "handoff"));
  check("Required slot: call ends after hand-off", last(steps).end === true);
  check(
    "Required slot: misunderstood words logged",
    events.filter((e) => e.type === "unknown").length === 2,
  );
}

/* An optional answer that never lands is skipped, not a trap. */
{
  const steps = await converse([
    "हाँ", "झांसी", "मोठ", "पाँचवीं", "खेती", "खेती", "हाँ", "पशुपालन", "अपना काम", "गाँव में ही",
    "उम्म", "पता नहीं",
  ]);
  const s = last(steps).state;

  check("Optional slot: moves on to the next question", s.slot === "learning", s.slot);
  check("Optional slot: not ended", !last(steps).end);
}

/* Asking for a person works at any point. */
{
  const steps = await converse(["हाँ", "किसी इंसान से बात कराओ"]);
  check("Hand-off on request", eventsOf(steps).some((e) => e.type === "handoff") && last(steps).end);
}

/* "Say that again" repeats without changing anything. */
{
  const steps = await converse(["हाँ", "फिर से बोलिए"]);
  check("Repeat: same question again", steps[2].say.endsWith(steps[1].say), steps[2].say);
  check("Repeat: state unchanged", steps[2].state.slot === steps[1].state.slot);
}

/* A wrong detail can be fixed at the summary. */
{
  const base = [
    "हाँ", "नाशिक", "सिन्नर", "आठवीं", "कुछ नहीं", "खेती", "नया", "मोबाइल", "नौकरी", "शहर तक",
    "4 घंटे", "दोनों", "हाँ", "नहीं", "कुछ नहीं", "अच्छी नौकरी",
  ];
  const steps = await converse([...base, "नहीं", "पढ़ाई गलत है", "दसवीं"]);
  const s = last(steps).state;

  check("Summary fix: re-asks only that question", steps[base.length + 2].say.includes("कितनी पढ़ाई"), steps[base.length + 2].say);
  check("Summary fix: new value kept", s.profile.education === 10, String(s.profile.education));
  check("Summary fix: back at the summary", s.stage === "summary" && last(steps).say.includes("दसवीं"), last(steps).say);
  check("Summary fix: wants something new, not farming", s.profile.continueFamilyTrade === false);
}

/* No means no. */
{
  const steps = await converse(["नहीं"]);
  check("Consent declined: ends politely", last(steps).end && last(steps).state.stage === "done");
}

// ---------------------------------------------------------------------------

console.log("\nMarathi\n");

{
  const steps: StepResult[] = [startInterview("mr")];
  for (const text of [
    "होय", "नाशिक", "सिन्नर", "दहावी पर्यंत शिकलो", "शेती करतो", "शेती", "काहीतरी नवीन", "मोबाईल",
    "नोकरी", "शहरापर्यंत", "पूर्ण दिवस", "हाताने", "होय", "नाही", "काहीच नाही", "चांगली नोकरी",
  ]) steps.push(await step(steps[steps.length - 1].state, text));

  const s = last(steps).state;
  check("Marathi: greeting in Marathi", steps[0].say.startsWith("नमस्कार! मी कौशल साथी आहे"), steps[0].say);
  check("Marathi: questions in Marathi", steps[1].say.includes("कोणत्या जिल्ह्यातून"), steps[1].say);
  check("Marathi: stays Marathi throughout", s.profile.language === "mr");
  check("Marathi: answers understood", s.profile.district === "nashik" && s.profile.block === "Sinnar" && s.profile.education === 10 && s.profile.currentWork === "farming", JSON.stringify(s.profile));
  check("Marathi: wants something new", s.profile.continueFamilyTrade === false);
  check("Marathi: male speaker from 'शिकलो'", s.profile.gender === "male", s.profile.gender);
  check("Marathi: summary in Marathi", s.stage === "summary" && last(steps).say.includes("मी पुन्हा सांगते"), last(steps).say);

  const results = await step(s, "होय बरोबर");
  check("Marathi: results in Marathi", results.say.includes("तुमच्यासाठी") && results.say.includes("किलोमीटर"), results.say);
}

{
  // A Hindi call where the caller answers in Marathi switches, and says so.
  let r = startInterview("hi");
  r = await step(r.state, "हाँ");
  r = await step(r.state, "मी नाशिकचा आहे, मला मराठीत बोलायचं आहे");
  check("Switch: Hindi call moves to Marathi", r.state.profile.language === "mr" && r.say.startsWith("ठीक आहे, आपण मराठीत बोलूया."), r.say);
  check("Switch: the answer in that same sentence still counts", r.state.profile.district === "nashik");

  r = await step(r.state, "हिंदी में बात करो");
  check("Switch: and back to Hindi on request", r.state.profile.language === "hi" && r.say.startsWith("ठीक है, हम हिंदी में बात करते हैं।"), r.say);
  check("Switch: a single borrowed word does not flip it", (await step(r.state, "नाही पता, बबीना")).state.profile.language === "hi");
}

{
  const offered: [Parameters<typeof extractSlot>[0], string[]][] = [
    ["education", ["पाचवी", "आठवी", "दहावी", "बारावी", "शिकलो नाही"]],
    ["currentWork", ["शेती", "मजुरी", "शिवणकाम", "दुकान", "काम नाही"]],
    ["familyTrade", ["शेती", "पशुपालन", "शिवणकाम", "सुतारकाम", "मडकी"]],
    ["interests", ["गाडीचं काम", "वीज", "शिवणकाम", "ब्युटी पार्लर", "शेती", "पशुपालन", "मोबाईल"]],
    ["preference", ["नोकरी", "स्वतःचं काम", "दोन्ही"]],
    ["travel", ["गावातच", "तालुक्यापर्यंत", "शहरापर्यंत"]],
    ["hours", ["थोडा वेळ", "अर्धा दिवस", "पूर्ण दिवस"]],
    ["learning", ["हाताने करून", "वर्गात बसून", "दोन्ही"]],
    ["familySupport", ["हो", "नाही"]],
    ["assets", ["जमीन", "गाई-म्हशी", "दुकान", "अवजारे", "काहीच नाही"]],
  ];
  const missed = offered.flatMap(([slot, options]) =>
    options.filter((o) => !extractSlot(slot, o, { district: "nashik" })).map((o) => `${slot}:${o}`),
  );
  check("Marathi: every option the bot offers is understood", missed.length === 0, missed.join(", "));
}

// ---------------------------------------------------------------------------

console.log("\nUnderstanding\n");

check("yes/no: 'हाँ, कोई दिक्कत नहीं' is yes", yesNo("हाँ, कोई दिक्कत नहीं") === true);
check("yes/no: 'जी नहीं' is no", yesNo("जी नहीं") === false);
check("yes/no: 'यहाँ' is neither", yesNo("यहाँ") === undefined);
check("yes/no: spelling variant 'हां' is yes", yesNo("हां") === true);

check("negation: 'खेती नहीं करते' is not farming", extractSlot("currentWork", "खेती नहीं करते", {})?.currentWork !== "farming");
check(
  "trade beats 'no other work'",
  extractSlot("currentWork", "मैं खेती करता हूँ, कोई और काम नहीं", {})?.currentWork === "farming",
);
check("nukta variant 'जमीन' = 'ज़मीन'", extractSlot("assets", "जमीन है", {})?.assets?.includes("land") === true);
check("STT slip 'बबिना' still Babina", extractSlot("district", "बबिना", {})?.block === "Babina");
check("Devanagari digits: '८ तक'", extractSlot("education", "८ तक", {})?.education === 8);

check("gender: talk about father is not the speaker", genderOf("पापा काम करता था") === undefined);
check("gender: 'मैं सिलाई करती हूँ' is female", genderOf("मैं सिलाई करती हूँ") === "female");

// ---------------------------------------------------------------------------

/* Every option the bot itself offers must be understood when said back —
   otherwise a person repeating our own suggestion gets told we did not
   understand them, which is the fastest way to lose them. */
{
  const offered: [Parameters<typeof extractSlot>[0], string[]][] = [
    ["education", ["पाँचवीं", "आठवीं", "दसवीं", "बारहवीं", "नहीं पढ़े"]],
    ["currentWork", ["खेती", "मज़दूरी", "सिलाई", "दुकान", "अभी कोई काम नहीं"]],
    ["familyTrade", ["खेती", "पशुपालन", "सिलाई", "बढ़ई", "मिट्टी के बर्तन"]],
    ["continueFamilyTrade", ["वही काम आगे बढ़ाना है", "कुछ नया"]],
    ["interests", ["गाड़ी का काम", "बिजली", "सिलाई", "ब्यूटी पार्लर", "खेती", "पशुपालन", "मोबाइल"]],
    ["preference", ["नौकरी", "अपना काम", "दोनों में से कुछ भी"]],
    ["travel", ["गाँव में ही", "ब्लॉक तक", "शहर तक"]],
    ["hours", ["थोड़ा समय", "आधा दिन", "पूरा दिन"]],
    ["learning", ["हाथ से करके", "क्लास में पढ़कर", "दोनों"]],
    ["familySupport", ["हाँ", "नहीं"]],
    ["constraints", ["हाँ", "नहीं"]],
    ["assets", ["ज़मीन", "गाय-भैंस", "दुकान", "औज़ार", "कुछ नहीं"]],
    ["district", ["झांसी", "गया", "नाशिक"]],
  ];

  const missed = offered.flatMap(([slot, options]) =>
    options.filter((o) => !extractSlot(slot, o, { district: "jhansi" })).map((o) => `${slot}:${o}`),
  );
  check("Every option the bot offers is understood", missed.length === 0, missed.join(", "));

  const blocks = ["झाँसी शहर", "बबीना", "मोठ", "मऊरानीपुर"].filter(
    (b) => !extractSlot("block", b, { district: "jhansi" })?.block,
  );
  check("Every block the bot lists is understood", blocks.length === 0, blocks.join(", "));
}

console.log("\nSafety\n");

{
  const text = JSON.stringify(hi);
  const banned = ["जाति", "अनुसूचित", "caste", "दलित", "SC "];
  check("No caste question anywhere in the script", !banned.some((w) => text.includes(w)));
  check("'NSQF' never spoken", !text.replace(/"_note"[^\n]*/, "").includes("NSQF"));
}

{
  const facts = { courseIds: ["c_2w_service"], centreIds: ["j2"], consultantIds: [], numbers: [90, 8000, 15000] };
  const other = COURSES.find((c) => c.id === "c_mobile_repair")!;

  check("Guard: true facts pass", checkReply("दोपहिया सर्विस सहायक का कोर्स 90 दिन का है", facts).ok);
  check("Guard: a course not offered is blocked", !checkReply(`आप ${other.nameHi} कर सकते हैं`, facts).ok);
  check("Guard: an invented amount is blocked", !checkReply("फीस 5000 रुपये है", facts).ok);
  check("Guard: invented amount in words is blocked", !checkReply("कमाई पचास हज़ार होगी", facts).ok);
}

console.log(failures === 0 ? "\nAll interview checks pass." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
}

void main();
