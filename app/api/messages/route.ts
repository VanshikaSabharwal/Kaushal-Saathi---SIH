/** A beneficiary's conversation (?id=), for staff in scope. */

import { staffProxy } from "../../lib/voice-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return staffProxy(request, "/internal/messages");
}
