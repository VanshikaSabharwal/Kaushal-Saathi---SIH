/** An uploaded certificate, for an officer to check: ?id=. Staff only, scoped to the signed-in role. */

import { staffProxy } from "../../../lib/voice-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return staffProxy(request, "/internal/beneficiaries/certificate");
}
