"use client";

/**
 * Sign in with a phone number and a one-time code — no password to remember.
 * In demo mode (OTP_DEV=1) the code is shown on screen, and says so.
 */

import { useState } from "react";
import {api, Button} from "./ui";

export default function PhoneLogin({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setError(null);
    const r = await api<{ devCode?: string }>("/api/me/otp/request", { body: { phone } });
    setBusy(false);

    if (!r.ok) return setError(r.data.error ?? "कोड नहीं भेज पाए, फिर कोशिश करें।");
    setSent(true);
    setDevCode(r.data.devCode ?? null);
  }

  async function verify() {
    setBusy(true);
    setError(null);
    const r = await api("/api/me/otp/verify", { body: { phone, code } });
    setBusy(false);

    if (!r.ok) return setError("कोड गलत है या पुराना हो गया। फिर से देखें।");
    onDone();
  }

  const input = "min-h-14 w-full rounded-xl border-2 border-[var(--border-strong)] bg-white px-4 text-2xl tracking-wider focus:border-[var(--ks-primary)] focus:outline-none";

  return (
    <div className="space-y-4">
      {!sent ? (
        <>
          <label className="flex items-center justify-between gap-2 text-lg font-semibold">
            अपना मोबाइल नंबर लिखिए
          </label>
          <input
            inputMode="numeric"
            autoComplete="tel"
            placeholder="98765 43210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={input}
          />
          <Button big className="w-full" onClick={send} disabled={busy || phone.replace(/\D/g, "").length < 10}>
            कोड भेजें
          </Button>
        </>
      ) : (
        <>
          <label className="flex items-center justify-between gap-2 text-lg font-semibold">
            फ़ोन पर आया 6 अंकों का कोड लिखिए
          </label>
          {devCode && (
            <p className="rounded-xl bg-[var(--ks-accent-soft)] px-4 py-2 text-sm">
              डेमो मोड — SMS नहीं भेजा गया। आपका कोड: <b translate="no" className="text-lg tracking-widest">{devCode}</b>
            </p>
          )}
          <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} className={input} />
          <Button big className="w-full" onClick={verify} disabled={busy || code.trim().length !== 6}>
            आगे बढ़ें
          </Button>
          <button className="w-full cursor-pointer text-sm underline" onClick={() => setSent(false)}>
            नंबर बदलें
          </button>
        </>
      )}
      {error && <p className="rounded-xl bg-[var(--danger-soft)] px-4 py-2 text-[var(--danger)]">{error}</p>}
    </div>
  );
}
