/** Verify (or un-verify) a consultant: { id, verified }. Staff only, scoped to the signed-in role. */

import { staffProxy } from "../../../lib/voice-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return staffProxy(request, "/internal/consultants/verify");
}
