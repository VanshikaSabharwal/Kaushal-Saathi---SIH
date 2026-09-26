"use client";

/**
 * Home for beneficiaries: sign in with a phone number (so the conversation is
 * saved to their record and "मेरी प्रगति" can show it), or just talk.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FiMic } from "react-icons/fi";
import PhoneLogin from "./components/ks/PhoneLogin";
import {Card} from "./components/ks/ui";


export default function Home() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/me", { cache: "no-store" }).then((r) => setSignedIn(r.ok)).catch(() => setSignedIn(false));
  }, []);

  useEffect(() => {
    if (signedIn) router.replace("/me");
  }, [signedIn, router]);

  if (signedIn !== false) return <p className="py-10 text-center text-[var(--text-muted)]">…</p>;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--ks-primary)]">नमस्ते! मैं कौशल साथी हूँ</h1>
            <p className="mt-2 text-lg">
              बोलकर बताइए आप क्या करना चाहते हैं — मैं आपके लिए सही सरकारी प्रमाणपत्र वाला कोर्स, पास का सेंटर और काम ढूँढूँगी।
            </p>
          </div>
        </div>
      </Card>

      <Card title="1. मोबाइल नंबर से शुरू करें">
        <PhoneLogin onDone={() => router.replace("/me")} />
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          इससे आपकी बातचीत और कोर्स आपके नंबर पर सुरक्षित रहेंगे। हम आपकी जाति या कोई दस्तावेज़ नहीं पूछते।
        </p>
      </Card>

      <Link href="/talk" className="block rounded-2xl border-2 border-[var(--ks-primary)] bg-white p-4 text-center text-lg font-semibold text-[var(--ks-primary)]">
        <FiMic className="mr-2 inline" aria-hidden />बिना नंबर के बात करें
      </Link>
    </div>
  );
}
