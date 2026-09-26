/**
 * The conversation test suite: 30 simulated beneficiaries talk to the
 * interview, and the run is scored the way the plan promised.
 *
 *   npm run eval:personas            # dictionary only, no keys, no cost
 *   npm run eval:personas -- --llm   # with the Groq fallback for misses
 *
 * Each persona is a small simulated person: when the assistant asks a
 * question, they answer it from their own script — sometimes in dialect,
 * sometimes unclearly the first time, sometimes in Marathi. So the flow is
 * driven by the assistant, as with a real caller, not by a fixed transcript.
 *
 * Pass bars (exit code 1 below any of them):
 *   - slot accuracy        >= 90%  answers understood as the person meant
 *   - right kind of work   >= 85%  an expected sector appears in the top 3
 *   - invented facts       == 0    no course named that was not on offer
 */

import { loadEnv } from "../lib/env";

loadEnv();

import { COURSES } from "../lib/livelihood/catalog";
import type { SlotId } from "../lib/livelihood/extract";
import { startInterview, step, type InterviewState } from "../lib/livelihood/interview";
import { groqExtractor } from "../lib/livelihood/llm-extract";
import { normalize } from "../lib/livelihood/text";
import type { Profile, Sector } from "../lib/livelihood/types";

type Persona = {
  name: string;
  lang?: "hi" | "mr";
  /** What they say to each question. An array is tried in order: a vague answer first, then a clearer one. */
  says: Partial<Record<SlotId | "consent" | "summary" | "stretch", string | string[]>>;
  /** What the profile should end up holding. */
  truth: Partial<Profile>;
  /** Any of these sectors in the top three counts as the right kind of work. */
  sectors: Sector[];
};

const base = { consent: "हाँ जी", summary: "हाँ सही है", aspiration: "अपने पैरों पर खड़ा होना है" };

const P: Persona[] = [
  { name: "Ramesh, cycle mechanic", says: { ...base, district: "मैं बबीना से हूँ", education: "आठवीं तक पढ़ा हूँ", currentWork: "पंक्चर की दुकान पर काम करता हूँ", familyTrade: "पापा साइकिल ठीक करते थे", continueFamilyTrade: "हाँ आगे बढ़ाना है", interests: "मोटरसाइकिल और इंजन का काम", preference: "अपना काम खोलना है", travel: "बीस किलोमीटर तक", hours: "पूरा दिन", learning: "हाथ से करके", familySupport: "हाँ", constraints: "नहीं", assets: "औज़ार हैं" },
    truth: { district: "jhansi", block: "Babina", education: 8, currentWork: "cycle_repair", familyTrade: "cycle_repair", preference: "self", maxTravelKm: 20 }, sectors: ["automotive"] },
  { name: "Kamla, potter", says: { ...base, district: "झांसी", block: "मोठ", education: "कभी स्कूल नहीं गई", currentWork: "मिट्टी के बर्तन बनाती हूँ", familyTrade: "कुम्हार का काम", continueFamilyTrade: "हाँ वही काम", interests: "मिट्टी और कारीगरी", preference: "अपना काम", travel: "गाँव में ही", hours: "चार घंटे", learning: "हाथ से", familySupport: "हाँ", constraints: "नहीं", assets: "चाक है" },
    truth: { district: "jhansi", block: "Moth", education: 0, familyTrade: "pottery", continueFamilyTrade: true, preference: "self", maxTravelKm: 5, hoursPerDay: 4 }, sectors: ["handicrafts"] },
  { name: "Sunita, wants tailoring", says: { ...base, district: "गया", block: "बोधगया", education: "दसवीं पास", currentWork: "घर का काम", familyTrade: "खेती", continueFamilyTrade: "कुछ नया", interests: "सिलाई और ब्यूटी पार्लर", preference: "अपना काम", travel: "पास में", hours: "दो घंटे", learning: "दोनों", familySupport: "हाँ", constraints: "नहीं", assets: "कुछ नहीं" },
    truth: { district: "gaya", block: "Bodh Gaya", education: 10, familyTrade: "farming", continueFamilyTrade: false, preference: "self", hoursPerDay: 2 }, sectors: ["apparel", "beauty"] },
  { name: "Imran, leaving leatherwork", lang: "hi", says: { ...base, district: "नाशिक", block: "नाशिक शहर", education: "दसवीं", currentWork: "कोई काम नहीं", familyTrade: "चमड़े का काम", continueFamilyTrade: "नहीं, कुछ नया सीखना है", interests: "मोबाइल ठीक करना", preference: "नौकरी", travel: "शहर तक", hours: "पूरा दिन", learning: "हाथ से", familySupport: "हाँ", constraints: "नहीं", assets: "कुछ नहीं" },
    truth: { district: "nashik", education: 10, familyTrade: "leatherwork", continueFamilyTrade: false, preference: "wage" }, sectors: ["electronics_repair"] },
  { name: "Geeta, back pain", says: { ...base, district: "गया", block: "टेकारी", education: "आठवीं", currentWork: "खेती", familyTrade: "खेती", continueFamilyTrade: "हाँ", interests: "खेती और पशु", preference: "अपना काम", travel: "गाँव में ही", hours: "चार घंटे", learning: "हाथ से", familySupport: "हाँ", constraints: "कमर में दर्द रहता है", assets: "ज़मीन है" },
    truth: { district: "gaya", block: "Tekari", education: 8, constraints: ["no_heavy_work"], assets: ["land"] }, sectors: ["agriculture", "dairy_livestock", "food_processing"] },
  { name: "Mohan, dairy family", says: { ...base, district: "झांसी", block: "मऊरानीपुर", education: "पाँचवीं", currentWork: "भैंस का दूध बेचता हूँ", familyTrade: "पशुपालन", continueFamilyTrade: "हाँ आगे बढ़ाऊंगा", interests: "गाय भैंस", preference: "अपना धंधा", travel: "दस किलोमीटर", hours: "आधा दिन", learning: "हाथ से", familySupport: "हाँ", constraints: "नहीं", assets: "दो भैंस हैं" },
    truth: { district: "jhansi", block: "Mauranipur", education: 5, currentWork: "dairy", familyTrade: "dairy", assets: ["livestock"] }, sectors: ["dairy_livestock"] },
  { name: "Pooja, 12th pass, office job", says: { ...base, district: "नाशिक", block: "सिन्नर", education: "बारहवीं", currentWork: "कुछ नहीं", familyTrade: "दुकान", continueFamilyTrade: "नहीं", interests: "कंप्यूटर", preference: "नौकरी", travel: "शहर तक", hours: "पूरा दिन", learning: "क्लास में", familySupport: "हाँ", constraints: "नहीं", assets: "कुछ नहीं" },
    truth: { district: "nashik", block: "Sinnar", education: 12, preference: "wage", learning: "classroom" }, sectors: ["it_ites", "retail", "healthcare"] },
  { name: "Raju, mason", says: { ...base, district: "गया", block: "गया शहर", education: "पाँचवीं", currentWork: "राजमिस्त्री हूँ", familyTrade: "मज़दूरी", interests: "मकान बनाना", preference: "नौकरी", travel: "शहर तक", hours: "पूरा दिन", learning: "हाथ से", familySupport: "हाँ", constraints: "नहीं", assets: "औज़ार" },
    truth: { district: "gaya", education: 5, currentWork: "masonry", preference: "wage" }, sectors: ["construction", "plumbing"] },
  { name: "Savita, embroidery at home", says: { ...base, district: "झांसी", block: "मोठ", education: "पाँचवीं", currentWork: "कढ़ाई करती हूँ", familyTrade: "सिलाई", continueFamilyTrade: "हाँ", interests: "कढ़ाई और सिलाई", preference: "अपना काम", travel: "घर के पास", hours: "दो घंटे", learning: "हाथ से", familySupport: "नहीं", constraints: "नहीं", assets: "सिलाई मशीन है" },
    truth: { district: "jhansi", currentWork: "embroidery", familySupport: false, assets: ["tools"] }, sectors: ["handicrafts", "apparel"] },
  { name: "Arjun, wants solar", says: { ...base, district: "झांसी", block: "झाँसी शहर", education: "दसवीं", currentWork: "बिजली का काम सीख रहा हूँ", familyTrade: "खेती", continueFamilyTrade: "नहीं", interests: "सोलर और बिजली", preference: "दोनों", travel: "तीस किलोमीटर", hours: "पूरा दिन", learning: "हाथ से", familySupport: "हाँ", constraints: "नहीं", assets: "कुछ नहीं" },
    truth: { district: "jhansi", block: "Jhansi City", education: 10, preference: "either", maxTravelKm: 30 }, sectors: ["solar", "electrical"] },
  { name: "Lakshmi, vague first answers", says: { ...base, district: ["पता नहीं", "गया"], block: "शेरघाटी", education: ["थोड़ा बहुत", "आठवीं"], currentWork: "घरों में काम करती हूँ", familyTrade: "खेती", continueFamilyTrade: "कुछ और", interests: ["कुछ भी"], preference: "अपना काम", travel: "गाँव में ही", hours: "थोड़ा", learning: "हाथ से", familySupport: "हाँ", constraints: "नहीं", assets: "कुछ नहीं" },
    truth: { district: "gaya", block: "Sherghati", education: 8, currentWork: "domestic_work" }, sectors: ["apparel", "handicrafts", "food_processing", "agriculture", "dairy_livestock"] },
  { name: "Vikram, driver", says: { ...base, district: "नाशिक", block: "निफाड", education: "आठवीं", currentWork: "ऑटो चलाता हूँ", familyTrade: "खेती", continueFamilyTrade: "नहीं", interests: "डिलीवरी और गाड़ी", preference: "नौकरी", travel: "शहर तक", hours: "पूरा दिन", learning: "हाथ से", familySupport: "हाँ", constraints: "नहीं", assets: "कुछ नहीं" },
    truth: { district: "nashik", block: "Niphad", currentWork: "driving", preference: "wage" }, sectors: ["logistics", "automotive"] },
  { name: "Farida, beauty, women's batch", says: { ...base, district: "गया", block: "बोधगया", education: "दसवीं", currentWork: "कुछ नहीं", familyTrade: "कुछ नहीं", interests: "मेहंदी और मेकअप", preference: "अपना काम", travel: "पास में", hours: "चार घंटे", learning: "हाथ से", familySupport: "हाँ", constraints: "नहीं", assets: "कुछ नहीं" },
    truth: { district: "gaya", education: 10 }, sectors: ["beauty"] },
  { name: "Suresh, carpenter", says: { ...base, district: "झांसी", block: "झाँसी शहर", education: "आठवीं", currentWork: "बढ़ई का काम", familyTrade: "बढ़ईगिरी", continueFamilyTrade: "हाँ", interests: "लकड़ी और फर्नीचर", preference: "अपना काम", travel: "शहर तक", hours: "पूरा दिन", learning: "हाथ से", familySupport: "हाँ", constraints: "नहीं", assets: "औज़ार और दुकान है" },
    truth: { district: "jhansi", currentWork: "carpentry", familyTrade: "carpentry" }, sectors: ["furniture"] },
  { name: "Meena, pickles from home", says: { ...base, district: "नाशिक", block: "इगतपुरी", education: "पाँचवीं", currentWork: "खाना बनाती हूँ", familyTrade: "खेती", continueFamilyTrade: "नहीं", interests: "अचार पापड़ बनाना", preference: "अपना काम", travel: "घर के पास", hours: "दो घंटे", learning: "हाथ से", familySupport: "हाँ", constraints: "नहीं", assets: "थोड़ी बचत है" },
    truth: { district: "nashik", block: "Igatpuri", currentWork: "cooking" }, sectors: ["food_processing"] },
  { name: "Deepak, hospital job", says: { ...base, district: "गया", block: "गया शहर", education: "बारहवीं", currentWork: "कुछ नहीं", familyTrade: "कुछ नहीं", interests: "अस्पताल में मरीज़ की सेवा", preference: "नौकरी", travel: "शहर तक", hours: "पूरा दिन", learning: "क्लास में", familySupport: "हाँ", constraints: "नहीं", assets: "कुछ नहीं" },
    truth: { district: "gaya", education: 12, preference: "wage" }, sectors: ["healthcare"] },
  { name: "Anil, barber", says: { ...base, district: "झांसी", block: "मऊरानीपुर", education: "आठवीं", currentWork: "सैलून में बाल काटता हूँ", familyTrade: "नाई का काम", continueFamilyTrade: "हाँ", interests: "बाल काटना", preference: "अपना काम", travel: "गाँव में ही", hours: "आधा दिन", learning: "हाथ से", familySupport: "हाँ", constraints: "नहीं", assets: "दुकान की जगह है" },
    truth: { district: "jhansi", currentWork: "barber", familyTrade: "barber" }, sectors: ["beauty"] },
  { name: "Rekha, goats", says: { ...base, district: "गया", block: "शेरघाटी", education: "नहीं पढ़ी", currentWork: "बकरी पालती हूँ", familyTrade: "बकरी पालन", continueFamilyTrade: "हाँ", interests: "बकरी", preference: "अपना काम", travel: "गाँव में ही", hours: "चार घंटे", learning: "हाथ से", familySupport: "हाँ", constraints: "नहीं", assets: "बकरियाँ हैं" },
    truth: { district: "gaya", education: 0, currentWork: "goat_rearing", assets: ["livestock"] }, sectors: ["dairy_livestock"] },
  { name: "Sanjay, plumber helper", says: { ...base, district: "नाशिक", block: "निफाड", education: "आठवीं", currentWork: "पाइप का काम", familyTrade: "मजदूरी", interests: "नल और पाइप", preference: "दोनों", travel: "तीस किलोमीटर", hours: "पूरा दिन", learning: "हाथ से", familySupport: "हाँ", constraints: "नहीं", assets: "औज़ार" },
    truth: { district: "nashik", currentWork: "plumbing_helper", preference: "either" }, sectors: ["plumbing", "construction"] },
  { name: "Neha, graduate, retail", says: { ...base, district: "झांसी", block: "झाँसी शहर", education: "ग्रेजुएट", currentWork: "कुछ नहीं", familyTrade: "दुकान", continueFamilyTrade: "नहीं", interests: "मॉल में बिक्री", preference: "नौकरी", travel: "शहर तक", hours: "पूरा दिन", learning: "क्लास में", familySupport: "हाँ", constraints: "नहीं", assets: "कुछ नहीं" },
    truth: { district: "jhansi", education: 15, preference: "wage" }, sectors: ["retail", "it_ites"] },
  { name: "Kishan, organic farming (Bundeli-ish)", says: { ...base, district: "झांसी", block: "बबीना", education: "आठवीं", currentWork: "खेतीबाड़ी", familyTrade: "किसानी", continueFamilyTrade: "हाँ", interests: "जैविक खेती", preference: "अपना काम", travel: "पास में", hours: "चार घंटे", learning: "हाथ से", familySupport: "हाँ", constraints: "नहीं", assets: "खेत है", stretch: "हाँ, जा सकता हूँ" },
    truth: { district: "jhansi", currentWork: "farming", familyTrade: "farming", assets: ["land"] }, sectors: ["agriculture"] },
  { name: "Asha, poultry", says: { ...base, district: "झांसी", block: "मऊरानीपुर", education: "पाँचवीं", currentWork: "मुर्गी पालती हूँ", familyTrade: "खेती", continueFamilyTrade: "नहीं", interests: "मुर्गी पालन", preference: "अपना काम", travel: "गाँव में ही", hours: "आधा दिन", learning: "हाथ से", familySupport: "हाँ", constraints: "नहीं", assets: "ज़मीन है" },
    truth: { district: "jhansi", education: 5 }, sectors: ["dairy_livestock"] },
  { name: "Ravi, hotel work", says: { ...base, district: "गया", block: "बोधगया", education: "दसवीं", currentWork: "ढाबे पर काम करता हूँ", familyTrade: "मजदूरी", interests: "होटल", preference: "नौकरी", travel: "पास में", hours: "पूरा दिन", learning: "हाथ से", familySupport: "हाँ", constraints: "नहीं", assets: "कुछ नहीं" },
    truth: { district: "gaya", education: 10, preference: "wage" }, sectors: ["hospitality", "food_processing"] },
  { name: "Gopal, changes his mind at summary", says: { ...base, district: "झांसी", block: "बबीना", education: "आठवीं", currentWork: "कुछ नहीं", familyTrade: "खेती", continueFamilyTrade: "नहीं", interests: "गाड़ी का काम", preference: "अपना काम", travel: "बीस किलोमीटर", hours: "पूरा दिन", learning: "हाथ से", familySupport: "हाँ", constraints: "नहीं", assets: "कुछ नहीं", summary: ["नहीं", "पढ़ाई", "हाँ सही है"] },
    truth: { district: "jhansi", preference: "self" }, sectors: ["automotive"] },
  // Marathi callers (Nashik preset).
  { name: "Sachin (Marathi), farmer to mobile repair", lang: "mr", says: { consent: "होय", district: "नाशिक", block: "सिन्नर", education: "दहावी पर्यंत शिकलो", currentWork: "शेती करतो", familyTrade: "शेती", continueFamilyTrade: "काहीतरी नवीन", interests: "मोबाईल", preference: "नोकरी", travel: "शहरापर्यंत", hours: "पूर्ण दिवस", learning: "हाताने", familySupport: "होय", constraints: "नाही", assets: "काहीच नाही", aspiration: "चांगली नोकरी", summary: "होय बरोबर" },
    truth: { district: "nashik", block: "Sinnar", education: 10, currentWork: "farming", preference: "wage" }, sectors: ["electronics_repair"] },
  { name: "Sunanda (Marathi), tailoring", lang: "mr", says: { consent: "हो", district: "नाशिक", block: "इगतपुरी", education: "आठवी", currentWork: "शिवणकाम करते", familyTrade: "शेती", continueFamilyTrade: "नवीन", interests: "शिवणकाम", preference: "स्वतःचं काम", travel: "गावातच", hours: "थोडा वेळ", learning: "हाताने", familySupport: "होय", constraints: "नाही", assets: "जागा आहे", aspiration: "स्वतःचं दुकान", summary: "होय" },
    truth: { district: "nashik", block: "Igatpuri", education: 8, currentWork: "tailoring", preference: "self" }, sectors: ["apparel"] },
  { name: "Ganesh (Marathi), dairy", lang: "mr", says: { consent: "होय", district: "नाशिक", block: "निफाड", education: "सातवी", currentWork: "दूध विकतो", familyTrade: "पशुपालन", continueFamilyTrade: "तेच काम", interests: "गाई म्हशी", preference: "व्यवसाय", travel: "तालुक्यापर्यंत", hours: "अर्धा दिवस", learning: "हाताने", familySupport: "होय", constraints: "नाही", assets: "गाई आहेत", aspiration: "मोठा डेअरी", summary: "होय बरोबर" },
    truth: { district: "nashik", block: "Niphad", education: 7, familyTrade: "dairy", assets: ["livestock"] }, sectors: ["dairy_livestock"] },
  { name: "Priya, switches to Marathi mid-call", says: { ...base, district: "मी नाशिकची आहे, मला मराठीत बोलायचं आहे", block: "नाशिक शहर", education: "बारावी", currentWork: "काम नाही", familyTrade: "दुकान", continueFamilyTrade: "नवीन", interests: "संगणक", preference: "नोकरी", travel: "शहरापर्यंत", hours: "पूर्ण दिवस", learning: "वर्गात", familySupport: "होय", constraints: "नाही", assets: "काहीच नाही", summary: "होय बरोबर" },
    truth: { district: "nashik", education: 12, preference: "wage", language: "mr" }, sectors: ["it_ites", "retail", "healthcare"] },
  { name: "Bablu, mumbles then answers", says: { ...base, district: "गया", block: ["उम्म", "टेकारी"], education: "आठवीं", currentWork: ["हम्म क्या", "खेती"], familyTrade: "खेती", continueFamilyTrade: "हाँ", interests: "खेती", preference: "अपना काम", travel: "गाँव में", hours: "पूरा दिन", learning: "हाथ से", familySupport: "हाँ", constraints: "नहीं", assets: "ज़मीन" },
    truth: { district: "gaya", block: "Tekari", currentWork: "farming" }, sectors: ["agriculture"] },
  { name: "Shabnam, limited mobility", says: { ...base, district: "गया", block: "गया शहर", education: "दसवीं", currentWork: "कुछ नहीं", familyTrade: "सिलाई", continueFamilyTrade: "हाँ", interests: "सिलाई", preference: "अपना काम", travel: "पास में", hours: "चार घंटे", learning: "हाथ से", familySupport: "हाँ", constraints: "चलने में दिक्कत है", assets: "सिलाई मशीन" },
    truth: { district: "gaya", constraints: ["limited_mobility"] }, sectors: ["apparel", "handicrafts", "beauty", "electronics_repair", "it_ites"] },
];

const LLM = process.argv.includes("--llm") ? groqExtractor() : undefined;

function answerFor(p: Persona, key: string, attempt: number): string {
  const a = p.says[key as keyof Persona["says"]];
  if (a === undefined) return key === "stretch" ? "नहीं" : "पता नहीं";
  return Array.isArray(a) ? a[Math.min(attempt, a.length - 1)] : a;
}

/** Which question is the assistant asking right now? */
function asking(s: InterviewState): string {
  if (s.stage === "consent") return "consent";
  if (s.stage === "summary" || s.stage === "summaryFix") return "summary";
  if (s.stage === "stretch") return "stretch";
  if (s.stage === "slot") return s.slot!;
  return s.stage;
}

async function run(p: Persona) {
  let r = startInterview(p.lang ?? "hi");
  const said: string[] = [r.say];
  const tries: Record<string, number> = {};
  let turns = 0;

  while (turns < 60 && !r.end && !["results", "clarify"].includes(r.state.stage)) {
    // Anyone not scripted for the "it is farther" question says no.
    const key = asking(r.state);
    const n = tries[key] ?? 0;
    tries[key] = n + 1;
    r = await step(r.state, answerFor(p, key, n), { llm: LLM });
    said.push(r.say);
    turns++;
  }

  if (r.state.stage === "clarify") {
    r = await step(r.state, "पहला");
    said.push(r.say);
    turns++;
  }

  const shown = r.state.shown;
  const offered = new Set([...shown, ...(r.state.result?.more ?? [])].map((x) => x.course.id));

  // Invented facts: any catalogue course named aloud that was never on offer.
  const invented = COURSES.filter(
    (c) => !offered.has(c.id) && said.some((line) => normalize(line).includes(normalize(c.nameHi))),
  ).map((c) => c.id);

  let slotsRight = 0;
  let slotsTotal = 0;
  const wrong: string[] = [];

  for (const [k, want] of Object.entries(p.truth)) {
    slotsTotal++;
    const got = r.state.profile[k as keyof Profile];
    const ok = JSON.stringify(got) === JSON.stringify(want) ||
      (Array.isArray(want) && Array.isArray(got) && want.every((w) => (got as unknown[]).includes(w)));
    if (ok) slotsRight++;
    else wrong.push(`${k}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }

  const top = shown.map((x) => x.course.sector);
  const rightWork = top.some((s) => p.sectors.includes(s));

  return { turns, slotsRight, slotsTotal, wrong, rightWork, top: shown.map((x) => x.course.id), invented, handedOff: r.state.stage === "handoff", llmCalls: r.state.llmCalls };
}

async function main(): Promise<void> {
  let right = 0;
  let total = 0;
  let work = 0;
  let invented = 0;
  let turns = 0;
  let llm = 0;

  console.log(`Persona suite — ${P.length} people, ${LLM ? "with" : "without"} the LLM fallback\n`);

  for (const p of P) {
    const r = await run(p);
    right += r.slotsRight;
    total += r.slotsTotal;
    work += r.rightWork ? 1 : 0;
    invented += r.invented.length;
    turns += r.turns;
    llm += r.llmCalls;

    const mark = r.rightWork && r.wrong.length === 0 && !r.invented.length ? "PASS" : "FAIL";
    console.log(`${mark}  ${p.name.padEnd(42)} ${r.turns} turns · slots ${r.slotsRight}/${r.slotsTotal} · top3 ${r.top.join(", ") || "(none)"}${r.handedOff ? " · handed off" : ""}`);
    for (const w of r.wrong) console.log(`        ${w}`);
    if (!r.rightWork) console.log(`        expected one of: ${p.sectors.join(", ")}`);
    if (r.invented.length) console.log(`        INVENTED: ${r.invented.join(", ")}`);
  }

  const slotAcc = right / total;
  const workRate = work / P.length;

  console.log(`\nslot accuracy     ${(slotAcc * 100).toFixed(1)}%  (bar 90%)`);
  console.log(`right kind of work ${(workRate * 100).toFixed(1)}%  (bar 85%)`);
  console.log(`invented facts    ${invented}      (bar 0)`);
  console.log(`avg turns         ${(turns / P.length).toFixed(1)}`);
  console.log(`LLM calls         ${llm} (${(llm / P.length).toFixed(2)} per person)`);

  const pass = slotAcc >= 0.9 && workRate >= 0.85 && invented === 0;
  console.log(pass ? "\nSuite passes." : "\nSuite below the bar.");
  process.exit(pass ? 0 : 1);
}

void main();
