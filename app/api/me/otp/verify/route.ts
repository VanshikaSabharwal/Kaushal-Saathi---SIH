/** Check the code; on success, a signed 30-day beneficiary session cookie. */

import { BENEFICIARY_COOKIE, createToken, sessionCookie } from "../../../../../lib/auth/session";
import { callVoice } from "../../../../lib/voice-proxy";

export const dynamic = "force-dynamic";

const DAYS = 30;

export async function POST(request: Request) {
  const res = await callVoice("/internal/otp/verify", { method: "POST", body: await request.json().catch(() => ({})) });
  const data = await res.json();
  if (!res.ok) return Response.json(data, { status: res.status });

  const token = createToken({
    kind: "beneficiary",
    beneficiaryId: data.beneficiaryId,
    phone: data.phone,
    exp: Date.now() + DAYS * 86400 * 1000,
  });

  return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(BENEFICIARY_COOKIE, token, DAYS * 86400) } });
}
