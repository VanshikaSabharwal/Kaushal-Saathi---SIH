/** Record a loan decision for a case: { beneficiaryId, sanctioned, scheme?, note? }. Staff only, scoped to the signed-in role. */

import { staffProxy } from "../../../lib/voice-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return staffProxy(request, "/internal/consultants/loan");
}
