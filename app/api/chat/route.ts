/**
 * Text chat with Kaushal Saathi: { sessionId?, text?, language? }.
 *
 * Open to anyone; a signed-in beneficiary chats as themselves (help desk for
 * their own course), anyone else gets a fresh interview.
 */

import { beneficiarySession, callVoice } from "../../lib/voice-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return callVoice("/internal/chat", { method: "POST", body, session: beneficiarySession(request) });
}
