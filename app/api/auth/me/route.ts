/** The signed-in staff member, or 401. */

import { staffSession } from "../../../lib/voice-proxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const s = staffSession(request);
  return s ? Response.json({ user: s }) : Response.json({ error: "Not signed in." }, { status: 401 });
}
