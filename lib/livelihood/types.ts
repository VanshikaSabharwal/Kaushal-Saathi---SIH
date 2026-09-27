/**
 * Shapes for the livelihood core: what the interview collects, what the
 * catalogue holds, and what the recommender returns.
 *
 * Deliberately free of framework imports so the voice server, the Next routes
 * and the verify scripts all share one definition.
 */

export type Sector =
  | "automotive" | "electrical" | "solar" | "electronics_repair" | "plumbing"
  | "construction" | "furniture" | "apparel" | "handicrafts" | "leather"
  | "beauty" | "dairy_livestock" | "agriculture" | "food_processing" | "retail"
  | "logistics" | "healthcare" | "it_ites" | "hospitality";

export type Outcome = "wage" | "self" | "both";
export type Preference = "wage" | "self" | "either";
export type Asset = "land" | "livestock" | "shop_space" | "tools" | "savings";
export type Constraint = "no_heavy_work" | "limited_mobility" | "visual" | "hearing";
/** Languages the voice assistant speaks: a data/i18n/<code>.json per entry. */
export const VOICE_LANGUAGES = ["hi", "mr", "en", "kok", "te", "as", "bn"] as const;
export type Language = (typeof VOICE_LANGUAGES)[number];

/** A voice language from a loose code ("te", "te-IN"), or undefined. */
export function asLanguage(code: unknown): Language | undefined {
  const c = typeof code === "string" ? code.split("-")[0].toLowerCase() : "";
  return (VOICE_LANGUAGES as readonly string[]).includes(c) ? (c as Language) : undefined;
}

/**
 * Everything the interview learns about one person.
 *
 * Education is years of schooling (0, 5, 8, 10, 12, 15 for a graduate), which
 * keeps "meets the minimum" a plain comparison. Nothing here asks about caste:
 * everyone using the app is treated as eligible.
 */
export type Profile = {
  district: string;
  block: string;
  language: Language;
  education: number;
  familyTrade?: string;
  /**
   * Whether the person wants to build on the family trade. Undefined means
   * not asked yet. False removes that trade's pull entirely, so the system
   * never steers someone back into an occupation they want to leave.
   */
  continueFamilyTrade?: boolean;
  currentWork?: string;
  interestSectors: Sector[];
  /** Skills the person told us about directly, beyond what their trades imply. */
  skills: string[];
  preference: Preference;
  maxTravelKm: number;
  canRelocate: boolean;
  constraints: Constraint[];
  assets: Asset[];
  /** Hours a day free for training, when known. */
  hoursPerDay?: number;
  /** How the person prefers to learn — a strong signal of who finishes a course. */
  learning?: "hands_on" | "classroom" | "either";
  /** Whether the family will back the training. Unknown is treated as neutral. */
  familySupport?: boolean;
  gender?: "female" | "male" | "other";
  age?: number;
  aspiration?: { goal?: string; targetMonthlyIncome?: number };
};

export type Course = {
  id: string;
  name: string;
  nameHi: string;
  sector: Sector;
  nsqfLevel: number;
  minEducation: number;
  durationDays: number;
  mode: "full_time" | "part_time";
  outcome: Outcome;
  physicallyDemanding: boolean;
  homeBased: boolean;
  rplAvailable: boolean;
  requiredSkills: string[];
  helpfulAssets: Asset[];
  incomeMonthly: [number, number];
  verified: boolean;
};

export type Centre = {
  id: string;
  name: string;
  type: "ITI" | "PMKVY" | "JSS";
  district: string;
  block: string;
  lat: number;
  lon: number;
  womenOnlyBatch: boolean;
  accessible: boolean;
  sample: boolean;
  courses: string[];
};

export type Block = { name: string; nameHi: string; lat: number; lon: number };

export type District = {
  id: string;
  name: string;
  nameHi: string;
  state: string;
  defaultLanguage: Language;
  blocks: Block[];
  demand: Partial<Record<Sector, number>>;
};

export type Trade = {
  hi: string;
  sector: Sector | null;
  skills: string[];
  pathway: string[];
};

export type Consultant = {
  id: string;
  name: string;
  district: string;
  blocks: string[];
  languages: Language[];
  specialisations: string[];
  verified: boolean;
  capacity: number;
  activeCases: number;
  sample: boolean;
};

export type Scheme = {
  id: string;
  appliesTo: string[];
  name: string;
  hi: string;
  en: string;
};

/** A reason is a code plus both renderings, so UI and voice never diverge. */
export type Reason = {
  code: string;
  hi: string;
  en: string;
  /** Values the reason mentions, so other languages can render it too. */
  vars?: Record<string, string | number>;
};

export type SkillGap = {
  /** Required skills the person already has. */
  have: string[];
  /** Required skills still to learn, foundation skills included. */
  need: string[];
  /** Share of the course's own required skills already covered, 0-1. */
  coverage: number;
  /** Suggest certification of existing skills instead of full training. */
  rpl: boolean;
};

export type Recommendation = {
  course: Course;
  score: number;
  components: {
    interest: number;
    familyTrade: number;
    demand: number;
    preference: number;
    level: number;
  };
  centre: Centre;
  distanceKm: number;
  reasons: Reason[];
  skillGap: SkillGap;
  consultant?: Consultant;
  schemes: Scheme[];
  /** The model's estimate that this person finishes this course, with why. */
  completion?: import("../ml/model").Completion;
  /** What the district's own planning documents say about this line of work. */
  opportunities: import("./opportunities").OpportunityCard[];
};

export type RecommendResult = {
  picks: Recommendation[];
  /** Everything that passed the filters, ranked — backs "और विकल्प". */
  more: Recommendation[];
  /**
   * The top two are too close to call. The interview should ask one more
   * question rather than present a coin toss as a recommendation.
   */
  clarify: boolean;
  /**
   * The best course in the person's own interests that failed only on
   * distance — offered as a question ("it is 45 km away; could you go?")
   * rather than silently replaced by work they never asked for.
   */
  farther?: Recommendation;
};
