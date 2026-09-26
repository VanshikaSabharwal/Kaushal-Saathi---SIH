/** Staff sign-out. */

import { clearCookie, STAFF_COOKIE } from "../../../../lib/auth/session";

export async function POST() {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearCookie(STAFF_COOKIE) } });
}
