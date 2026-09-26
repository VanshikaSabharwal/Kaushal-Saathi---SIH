/** Stored opportunity cards (see lib/livelihood/opportunities.ts). */

import type { OpportunityCard } from "../livelihood/opportunities";
import { createCollection } from "./collection";

export const opportunities = createCollection<OpportunityCard>("opportunities", { max: 20000 });
