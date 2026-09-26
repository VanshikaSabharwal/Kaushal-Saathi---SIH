"use client";

/**
 * "मेरी जानकारी" — everything about the person other than their courses: what
 * they told the assistant, where they are in the pipeline, complaints,
 * certificate upload, the Skill India Digital Hub link, the story so far,
 * and sign-out / erase-my-data.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FiArrowLeft, FiCheck, FiCheckCircle, FiLogOut, FiTrash2, FiUpload } from "react-icons/fi";
import { getDistrict } from "../../../lib/livelihood/catalog";
import { educationText, sectorName, tpl, tradeName } from "../../../lib/livelihood/i18n";
import type { Beneficiary } from "../../../lib/store/beneficiaries";
import {api, Button, Card, fmtDate, PIPELINE, pipelineIndex, STATUS_HI} from "../../components/ks/ui";

const T = tpl("hi");

type Ticket = { id: string; status: string; category?: string; text?: string; createdAt: number; dueAt: number };
type Sidh = { mock: boolean; note: string; enrolments: { courseName: string; progressPercent: number; status: string }[] };

const LEARNING_HI: Record<string, string> = { hands_on: "हाथ से करके", classroom: "क्लास में पढ़कर", either: "दोनों तरह" };

const TIMELINE_HI: Record<string, string> = {
  registered: "पंजीकरण हुआ",
  call_started: "कौशल साथी से बात हुई",
  profile_completed: "आपकी जानकारी पूरी हुई",
  recommended: "आपको कोर्स बताए गए",
  interested: "आपने कोर्स चुना",
  status: "स्थिति बदली",
  ticket: "शिकायत दर्ज हुई",
  progress_reported: "आपने प्रगति बताई",
  followup: "हालचाल कॉल",
  certificate_verified: "प्रमाणपत्र जाँचा गया",
  loan: "कर्ज़ पर फ़ैसला",
  handoff: "साथी से बात के लिए भेजा गया",
  new_search: "नया कोर्स ढूँढा",
};

export default function ProfilePage() {
  const router = useRouter();
  const [b, setB] = useState<Beneficiary | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [sidh, setSidh] = useState<Sidh | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await api<{ beneficiary: Beneficiary; tickets: Ticket[] }>("/api/me");
      if (cancelled) return;
      if (r.status === 401) return router.replace("/");
      setB(r.data.beneficiary ?? null);
      setTickets(r.data.tickets ?? []);
      const s = await api<{ sidh: Sidh }>("/api/me/sidh");
      if (!cancelled && s.ok) setSidh(s.data.sidh);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, version]);

  async function upload(file: File) {
    if (file.size > 5 * 1024 * 1024) return setMsg("फ़ाइल 5 MB से छोटी होनी चाहिए।");
    const dataBase64 = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.readAsDataURL(file);
    });
    const r = await api("/api/me/certificate", { body: { contentType: file.type, dataBase64 } });
    setMsg(r.ok ? "प्रमाणपत्र मिल गया! अधिकारी जाँच करेंगे।" : r.data.error ?? "अपलोड नहीं हो पाया।");
    if (r.ok) setVersion((v) => v + 1);
  }

  async function erase() {
    if (!confirm("क्या आप सच में अपनी सारी जानकारी हटाना चाहते हैं? यह वापस नहीं आएगी।")) return;
    const r = await api("/api/me/delete", { method: "POST", body: {} });
    if (r.ok) router.replace("/");
  }

  async function logout() {
    await fetch("/api/me/logout", { method: "POST" });
    router.replace("/");
  }

  if (!b) return <p className="py-10 text-center text-[var(--text-muted)]">…</p>;

  const p = b.profile;
  const d = getDistrict(p.district ?? b.district ?? "");
  const blockHi = d?.blocks.find((x) => x.name === (p.block ?? b.block))?.nameHi ?? p.block ?? "";
  const step = pipelineIndex(b.status);

  const rows: [string, string][] = [
    ["जगह", [blockHi, d?.nameHi].filter(Boolean).join(", ")],
    ["पढ़ाई", educationText(p.education, T)],
    ["अभी का काम", p.currentWork ? tradeName(p.currentWork, T) : "—"],
    ["परिवार का काम", p.familyTrade ? `${tradeName(p.familyTrade, T)}${p.continueFamilyTrade === false ? " (कुछ नया चाहते हैं)" : ""}` : "—"],
    ["पसंद का काम", p.interestSectors?.length ? p.interestSectors.map((s) => sectorName(s, T)).join(", ") : "—"],
    ["नौकरी या अपना काम", T.preferenceText[p.preference ?? "either"]],
    ["रोज़ कितनी दूर", p.canRelocate ? "बाहर भी जा सकते हैं" : p.maxTravelKm ? `${p.maxTravelKm} किलोमीटर तक` : "—"],
    ["दिन में समय", p.hoursPerDay ? `${p.hoursPerDay} घंटे` : "—"],
    ["सीखने का तरीका", p.learning ? LEARNING_HI[p.learning] : "—"],
    ["घर वालों का साथ", p.familySupport === undefined ? "—" : p.familySupport ? "हाँ" : "नहीं"],
    ["पास में साधन", p.assets?.length ? p.assets.map((a) => (T.assets as Record<string, string>)[a] ?? a).join(", ") : "—"],
    ["आपका सपना", p.aspiration?.goal ?? "—"],
  ];

  return (
    <div className="space-y-5">
      <Link href="/me" className="inline-flex items-center gap-1 text-base underline">
        <FiArrowLeft aria-hidden /> मेरे कोर्स
      </Link>

      <Card title="आपकी स्थिति">
        <p className="text-2xl font-bold text-[var(--ks-primary)]">{STATUS_HI[b.status]}</p>
        {step >= 0 && (
          <ol className="mt-4 grid grid-cols-5 gap-1 text-center text-[11px] sm:text-xs">
            {PIPELINE.map((s, i) => (
              <li key={s} className="flex flex-col items-center gap-1">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                    i <= step ? "bg-[var(--success)] text-white" : "bg-[var(--surface-muted)] text-[var(--text-subtle)]"
                  }`}
                >
                  {i < step ? <FiCheck aria-hidden /> : i + 1}
                </span>
                <span className={i <= step ? "font-semibold" : "text-[var(--text-subtle)]"}>
                  {s === "placed" ? "नौकरी / अपना काम" : STATUS_HI[s]}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card title="आपने हमें क्या बताया">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k} className="border-b border-[var(--border)] py-1.5">
              <dt className="text-sm text-[var(--text-muted)]">{k}</dt>
              <dd className="text-base font-medium">{v || "—"}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm text-[var(--text-muted)]">कुछ गलत है? कौशल साथी से बात करके “नया कोर्स” बोलिए और सही जानकारी दीजिए।</p>
      </Card>

      <Card title="मेरी शिकायतें">
        {tickets.length === 0 ? (
          <p className="text-base text-[var(--text-muted)]">
            कोई शिकायत नहीं। कोई दिक्कत हो तो कौशल साथी से बात करते समय बताएँ।
          </p>
        ) : (
          <ul className="space-y-2">
            {tickets.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border)] p-3">
                <div>
                  <p className="font-medium">
                    नंबर <span translate="no">{t.id.replace(/-/g, "").slice(0, 6).toUpperCase()}</span> — {t.text}
                  </p>
                  <p className="text-sm text-[var(--text-muted)]">{fmtDate(t.createdAt)}</p>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-sm ${t.status === "open" ? "bg-[var(--ks-accent-soft)]" : "bg-[var(--success-soft)] text-[var(--success)]"}`}>
                  {t.status === "open" ? "काम चल रहा है" : "सुलझ गई"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {b.chosen && (
        <Card title="प्रमाणपत्र">
          {b.certificate ? (
            <p className="flex items-center gap-2 text-base">
              <FiCheckCircle className="text-[var(--success)]" aria-hidden />
              प्रमाणपत्र मिल गया ({fmtDate(b.certificate.uploadedAt)}) — {b.certificate.verified ? "अधिकारी ने जाँच लिया है।" : "अधिकारी जाँच करेंगे।"}
            </p>
          ) : (
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--border-strong)] p-4 text-lg">
              <FiUpload aria-hidden /> प्रमाणपत्र की फ़ोटो या PDF डालें
              <input type="file" accept="image/jpeg,image/png,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </label>
          )}
          {msg && <p className="mt-2 text-base">{msg}</p>}
        </Card>
      )}

      {sidh && (
        <Card title="Skill India Digital Hub">
          <p className="rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--text-muted)]">{sidh.note}</p>
          {sidh.enrolments.map((e) => (
            <div key={e.courseName} className="mt-3">
              <p className="text-sm" translate="no">{e.courseName}</p>
              <div className="mt-1 h-3 rounded-full bg-[var(--surface-muted)]">
                <div className="h-3 rounded-full bg-[var(--success)]" style={{ width: `${e.progressPercent}%` }} />
              </div>
            </div>
          ))}
        </Card>
      )}

      <Card title="अब तक क्या हुआ">
        <ol className="space-y-2">
          {[...b.timeline].reverse().filter((t) => TIMELINE_HI[t.type]).slice(0, 15).map((t, i) => (
            <li key={i} className="flex gap-3 text-base">
              <span className="w-24 shrink-0 text-sm text-[var(--text-muted)]">{fmtDate(t.at)}</span>
              <span>
                {TIMELINE_HI[t.type]}
                {t.type === "status" && t.data?.to ? `: ${STATUS_HI[String(t.data.to)] ?? t.data.to}` : ""}
                {t.type === "loan" ? (t.data?.sanctioned ? ": मंज़ूर" : ": नामंज़ूर") : ""}
              </span>
            </li>
          ))}
        </ol>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 pb-6">
        <Button variant="ghost" onClick={logout} className="inline-flex items-center gap-2"><FiLogOut aria-hidden /> लॉग आउट</Button>
        <Button variant="danger" onClick={erase} className="inline-flex items-center gap-2"><FiTrash2 aria-hidden /> मेरी सारी जानकारी हटाएँ</Button>
      </div>
    </div>
  );
}
