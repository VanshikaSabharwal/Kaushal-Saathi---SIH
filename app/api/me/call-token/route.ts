/** A 2-minute ticket to start a voice call as the signed-in beneficiary. */

import { createToken } from "../../../../lib/auth/session";
import { beneficiarySession } from "../../../lib/voice-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const s = beneficiarySession(request);
  if (!s) return Response.json({ error: "Please sign in." }, { status: 401 });

  return Response.json({
    ticket: createToken({ kind: "call", beneficiaryId: s.beneficiaryId, exp: Date.now() + 2 * 60 * 1000 }),
  });
}
