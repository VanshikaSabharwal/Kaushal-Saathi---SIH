"use client";

/**
 * "सहायता" — the same assistant, typed instead of spoken. Signed in, it is the
 * help desk for the person's own course; otherwise it starts an interview.
 * Quick-reply chips cover the common questions for people who find typing
 * hard.
 */

import { useEffect, useRef, useState } from "react";
import {api, Button} from "../components/ks/ui";
import { useTranslation } from "../components/ks/Translate";
import { translateTexts } from "../lib/dom-translate";

type Msg = { role: "bot" | "me"; text: string };

const CHIPS = ["कोर्स कितने दिन का है?", "सेंटर कहाँ है?", "मेरा स्टाइपेंड नहीं आया", "मेरी शिकायत का क्या हुआ?", "नया कोर्स", "हाँ", "नहीं"];

export default function HelpPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [ended, setEnded] = useState(false);
  const bottom = useRef<HTMLDivElement | null>(null);
  const lang = useTranslation()?.lang.code ?? "hi";
  const started = useRef(false);

  async function send(t?: string, typed = false) {
    const body: Record<string, unknown> = { sessionId };

    // The assistant understands Hindi and Marathi. Anything typed in another
    // language is translated into Hindi on the way in; its replies are shown
    // back in the page's language by the site translator.
    if (t) {
      body.text = typed && lang !== "hi" && lang !== "mr" ? (await translateTexts([t], "hi", lang))[0] : t;
    }

    setBusy(true);
    if (t) setMsgs((m) => [...m, { role: "me", text: t }]);
    setText("");

    const r = await api<{ sessionId: string; reply: string; end: boolean }>("/api/chat", { body });
    setBusy(false);

    if (!r.ok) {
      setMsgs((m) => [...m, { role: "bot", text: "माफ़ कीजिए, अभी जवाब नहीं दे पा रही। थोड़ी देर में फिर कोशिश करें।" }]);
      return;
    }

    setSessionId(r.data.sessionId);
    setMsgs((m) => [...m, { role: "bot", text: r.data.reply }]);
    if (r.data.end) setEnded(true);
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [msgs]);

  function restart() {
    setSessionId(null);
    setMsgs([]);
    setEnded(false);
    started.current = false;
    setTimeout(() => void send(), 0);
  }

  return (
    <div className="flex h-[calc(100vh-10rem)] flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto pb-3">
        {msgs.map((m, i) => (
          <div
            key={i}
            className={`flex items-start gap-2 rounded-2xl px-4 py-3 text-lg ${
              m.role === "me" ? "ml-10 bg-[var(--ks-primary)] text-white" : "mr-10 border border-[var(--border)] bg-white"
            }`}
          >
            <p className="flex-1 whitespace-pre-wrap">{m.text}</p>
          </div>
        ))}
        {busy && <p className="text-[var(--text-muted)]">…</p>}
        <div ref={bottom} />
      </div>

      {ended ? (
        <Button big onClick={restart}>फिर से बात शुरू करें</Button>
      ) : (
        <>
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
            {CHIPS.map((c) => (
              <button
                key={c}
                disabled={busy}
                onClick={() => void send(c)}
                className="shrink-0 cursor-pointer rounded-full border border-[var(--border-strong)] bg-white px-3 py-1.5 text-base"
              >
                {c}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) void send(text.trim(), true);
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="यहाँ लिखें…"
              className="min-h-14 flex-1 rounded-xl border-2 border-[var(--border-strong)] bg-white px-4 text-lg focus:border-[var(--ks-primary)] focus:outline-none"
            />
            <Button big type="submit" disabled={busy || !text.trim()}>भेजें</Button>
          </form>
        </>
      )}
    </div>
  );
}
