/** Teach the interview an unknown answer: { id, mappedTo } (null to ignore). Staff only, scoped to the signed-in role. */

import { staffProxy } from "../../../lib/voice-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return staffProxy(request, "/internal/unknown-words/map");
}
