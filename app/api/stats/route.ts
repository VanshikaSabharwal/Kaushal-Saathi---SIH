/** Dashboard counts: beneficiaries by status, tasks, flags, drop-off, model. Staff only, scoped to the signed-in role. */

import { staffProxy } from "../../lib/voice-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return staffProxy(request, "/internal/stats");
}
