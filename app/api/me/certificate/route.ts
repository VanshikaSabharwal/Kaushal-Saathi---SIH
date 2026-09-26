/** Upload a certificate photo or PDF: { contentType, dataBase64 }. */

import { beneficiaryProxy } from "../../../lib/voice-proxy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return beneficiaryProxy(request, "/internal/beneficiaries/certificate", (s, body) => ({ ...body, id: s.beneficiaryId }));
}
