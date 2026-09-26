/**
 * Translate website text: { texts: string[], target, source? } → { translations }. Cached per sentence.
 *
 * Runs here rather than on the voice server, so reading the site in another
 * language keeps working when the voice server is down.
 */

import { MAX_TEXTS, translate } from "../../../lib/i18n/translate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { texts?: unknown; target?: unknown; source?: unknown };
  const texts = Array.isArray(body.texts) ? body.texts.filter((t): t is string => typeof t === "string") : [];
  const target = typeof body.target === "string" ? body.target : undefined;
  const source = typeof body.source === "string" ? body.source : "hi";

  if (!target || texts.length === 0 || texts.length > MAX_TEXTS) {
    return Response.json({ error: `Need target and 1–${MAX_TEXTS} texts.` }, { status: 400 });
  }
  return Response.json(await translate(texts, target, source));
}
