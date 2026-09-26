/** The Skill India Digital Hub connector (a clearly marked demo until partnership). */

import { beneficiaryProxy } from "../../../lib/voice-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return beneficiaryProxy(request, "/internal/sidh");
}
