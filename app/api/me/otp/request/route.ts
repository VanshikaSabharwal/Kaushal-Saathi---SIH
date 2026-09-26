/** Ask for a one-time code for "मेरी प्रगति": { phone }. */

import { callVoice } from "../../../../lib/voice-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return callVoice("/internal/otp/request", { method: "POST", body: await request.json().catch(() => ({})) });
}
