/** Staff sign-in: checks the password at the voice server, then sets a signed 8-hour session cookie. */

import { createToken, sessionCookie, STAFF_COOKIE, type Role } from "../../../../lib/auth/session";
import { callVoice } from "../../../lib/voice-proxy";

export const dynamic = "force-dynamic";

const HOURS = 8;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const res = await callVoice("/internal/auth/login", { method: "POST", body });
  const data = await res.json();

  if (!res.ok) return Response.json(data, { status: res.status });

  const u = data.user as {
    id: string; name: string; role: Role; state?: string; district?: string; centreId?: string; consultantId?: string;
  };
  const token = createToken({
    kind: "staff",
    userId: u.id,
    name: u.name,
    role: u.role,
    state: u.state,
    district: u.district,
    centreId: u.centreId,
    consultantId: u.consultantId,
    exp: Date.now() + HOURS * 3600 * 1000,
  });

  return Response.json({ user: u }, { headers: { "Set-Cookie": sessionCookie(STAFF_COOKIE, token, HOURS * 3600) } });
}
