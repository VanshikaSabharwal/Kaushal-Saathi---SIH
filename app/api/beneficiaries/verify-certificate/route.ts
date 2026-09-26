/** Mark an uploaded certificate verified: { id }. Staff only, scoped to the signed-in role. */

import { staffProxy } from "../../../lib/voice-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return staffProxy(request, "/internal/beneficiaries/verify-certificate");
}
