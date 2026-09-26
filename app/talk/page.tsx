"use client";

/**
 * The voice bot. Signed in, the call opens as the person (interview the first
 * time, help desk after); otherwise it is anonymous. ?kiosk=1 is for a shared
 * device at a CSC or panchayat: never signed in, and resets after each person.
 */

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FiFileText } from "react-icons/fi";
import VoiceTalk from "../components/ks/VoiceTalk";
import { useTranslation } from "../components/ks/Translate";
import {Card} from "../components/ks/ui";

function Talk() {
  const kiosk = useSearchParams().get("kiosk") === "1";
  const lang = useTranslation()?.lang;
  const [signedIn, setSignedIn] = useState(false);
  const [ended, setEnded] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (kiosk) return;
    fetch("/api/me", { cache: "no-store" }).then((r) => setSignedIn(r.ok)).catch(() => {});
  }, [kiosk]);

  const getTicket = useCallback(async () => {
    if (kiosk || !signedIn) return undefined;
    const r = await fetch("/api/me/call-token", { method: "POST" });
    return r.ok ? ((await r.json()).ticket as string) : undefined;
  }, [kiosk, signedIn]);

  // Kiosk: a fresh screen for the next person, shortly after a call ends.
  useEffect(() => {
    if (!kiosk || !ended) return;
    const t = setTimeout(() => {
      setEnded(false);
      setRound((n) => n + 1);
    }, 10000);
    return () => clearTimeout(t);
  }, [kiosk, ended]);

  return (
    <div className="space-y-4">
      {!signedIn && !kiosk && (
        <p className="rounded-xl bg-[var(--ks-accent-soft)] px-4 py-2 text-base">
          आप बिना नंबर के बात कर रहे हैं — बातचीत आपके नंबर पर सेव नहीं होगी।{" "}
          <Link href="/" className="font-semibold underline">नंबर से शुरू करें</Link>
        </p>
      )}

      {lang && !lang.voice && (
        <p className="rounded-xl bg-[var(--ks-primary-soft)] px-4 py-2 text-base">
          आवाज़ सहायक अभी हिन्दी और मराठी में बोलता है।
        </p>
      )}

      <VoiceTalk key={round} getTicket={getTicket} onEnded={() => setEnded(true)} />

      {ended && !kiosk && signedIn && (
        <Card>
          <Link href="/me" className="block rounded-xl bg-[var(--ks-primary)] px-4 py-4 text-center text-lg font-semibold text-white">
            <FiFileText className="mr-2 inline" aria-hidden />मेरे कोर्स और बातचीत देखें
          </Link>
        </Card>
      )}
      {ended && kiosk && <p className="text-center text-[var(--text-muted)]">अगले व्यक्ति के लिए स्क्रीन 10 सेकंड में फिर से शुरू होगी।</p>}
    </div>
  );
}

export default function TalkPage() {
  return (
    <Suspense fallback={null}>
      <Talk />
    </Suspense>
  );
}
