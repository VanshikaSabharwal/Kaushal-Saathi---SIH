/** Change a beneficiary's status: { id, status, note? }. Recorded as the signed-in role. Staff only, scoped to the signed-in role. */

import { staffProxy } from "../../../lib/voice-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return staffProxy(request, "/internal/beneficiaries/status");
}
