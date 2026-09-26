/** My conversation with the assistant, voice and chat, oldest first. */

import { beneficiaryProxy } from "../../../lib/voice-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return beneficiaryProxy(request, "/internal/messages");
}
