/** The signed-in beneficiary's own record — never anyone else's. */

import { beneficiaryProxy } from "../../lib/voice-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return beneficiaryProxy(request, "/internal/beneficiaries");
}
