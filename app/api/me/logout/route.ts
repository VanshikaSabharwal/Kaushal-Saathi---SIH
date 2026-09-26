/** Beneficiary sign-out. */

import { BENEFICIARY_COOKIE, clearCookie } from "../../../../lib/auth/session";

export async function POST() {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearCookie(BENEFICIARY_COOKIE) } });
}
