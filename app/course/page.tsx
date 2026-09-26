"use client";

/**
 * One course, in full: what it teaches, who it is for, what it can lead to,
 * where it is taught (with a map link), the schemes that apply, and — for a
 * signed-in person who was recommended it — their own skill gap and
 * consultant. Open to anyone: the catalogue is public information.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  FiArrowLeft,
  FiAward,
  FiBookOpen,
  FiBriefcase,
  FiCheckCircle,
  FiClock,
  FiExternalLink,
  FiMapPin,
  FiStar,
  FiTrendingUp,
  FiUsers,
} from "react-icons/fi";
import { CENTRES, CONSULTANTS, getCourse, getDistrict, SCHEMES, skillLabel } from "../../lib/livelihood/catalog";
import { durationText, tpl } from "../../lib/livelihood/i18n";
import type { Beneficiary } from "../../lib/store/beneficiaries";
import {api, Card} from "../components/ks/ui";

const T = tpl("hi");
const skill = (id: string) => skillLabel(id, "hi");

const EDU_HI: Record<number, string> = { 0: "कोई पढ़ाई ज़रूरी नहीं", 5: "पाँचवीं पास", 8: "आठवीं पास", 10: "दसवीं पास", 12: "बारहवीं पास", 15: "ग्रेजुएट" };
const OUTCOME_HI: Record<string, string> = { wage: "नौकरी", self: "अपना काम", both: "नौकरी या अपना काम" };

function CourseDetail() {
  const params = useSearchParams();
  const course = getCourse(params.get("id") ?? "");
  const centre = CENTRES.find((c) => c.id === params.get("centre"));
  const [me, setMe] = useState<Beneficiary | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Signed-in: show this person's own gap for this course. Otherwise, the course alone.
    api<{ beneficiary: Beneficiary }>("/api/me").then((r) => {
      if (!cancelled && r.ok) setMe(r.data.beneficiary);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!course) {
    return (
      <Card>
        <p className="text-lg">यह कोर्स नहीं मिला।</p>
        <Link href="/me" className="mt-2 inline-flex items-center gap-1 underline"><FiArrowLeft aria-hidden /> मेरे कोर्स</Link>
      </Card>
    );
  }

  const rec = me?.recommendations.find((r) => r.courseId === course.id);
  const consultant = CONSULTANTS.find((c) => c.id === (rec?.consultantId ?? (me?.chosen?.courseId === course.id ? me.chosen.consultantId : undefined)));
  const district = centre ? getDistrict(centre.district) : undefined;
  const block = district?.blocks.find((b) => b.name === centre?.block)?.nameHi ?? centre?.block;
  const schemes = SCHEMES.filter(
    (s) => s.id === "pmajay_gia" || (s.id === "rpl" && (rec?.rpl || course.rplAvailable)) || (s.id === "enterprise_loans" && course.outcome !== "wage"),
  );
  const mapUrl = centre ? `https://www.google.com/maps/search/?api=1&query=${centre.lat},${centre.lon}` : undefined;

  return (
    <div className="space-y-5">
      <Link href="/me" className="inline-flex items-center gap-1 text-base underline">
        <FiArrowLeft aria-hidden /> मेरे कोर्स
      </Link>

      <Card>
        <h1 className="text-3xl font-bold">{course.nameHi}</h1>
        <p className="text-base text-[var(--text-muted)]" translate="no">{course.name}</p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact icon={<FiClock />} label="अवधि" value={`${durationText(course.durationDays, T)} · ${course.mode === "part_time" ? "रोज़ कुछ घंटे" : "रोज़ पूरे दिन"}`} />
          <Fact icon={<FiAward />} label="सरकारी प्रमाणपत्र" value={`NSQF स्तर ${course.nsqfLevel}`} />
          <Fact icon={<FiBookOpen />} label="पढ़ाई की शर्त" value={EDU_HI[course.minEducation] ?? `${course.minEducation}वीं पास`} />
          <Fact icon={<FiTrendingUp />} label="आगे का रास्ता" value={OUTCOME_HI[course.outcome]} />
        </div>

        <p className="mt-4 text-base">
          इस काम में आम तौर पर कमाई: <b>₹{course.incomeMonthly[0].toLocaleString("en-IN")} – ₹{course.incomeMonthly[1].toLocaleString("en-IN")} महीना</b>
          <span className="block text-sm text-[var(--text-muted)]">अनुमान — जगह और मेहनत पर निर्भर।</span>
        </p>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="इस कोर्स में क्या सीखेंगे">
          <ul className="flex flex-wrap gap-1.5">
            {course.requiredSkills.map((s) => (
              <li key={s} className="rounded-full bg-[var(--ks-primary-soft)] px-3 py-1 text-base">{skill(s)}</li>
            ))}
          </ul>

          {rec && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="flex items-center gap-1 text-sm font-semibold text-[var(--success)]"><FiCheckCircle aria-hidden /> आपको पहले से आता है</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {rec.have.length ? rec.have.map((s) => <li key={s} className="rounded-full bg-[var(--success-soft)] px-2.5 py-0.5 text-sm">{skill(s)}</li>) : <li className="text-sm">—</li>}
                </ul>
              </div>
              <div>
                <p className="flex items-center gap-1 text-sm font-semibold text-[var(--ks-primary)]"><FiBookOpen aria-hidden /> आपको सीखना होगा</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {rec.need.map((s) => <li key={s} className="rounded-full bg-[var(--ks-primary-soft)] px-2.5 py-0.5 text-sm">{skill(s)}</li>)}
                </ul>
              </div>
            </div>
          )}

          {rec?.rpl && (
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-[var(--ks-accent-soft)] px-3 py-2">
              <FiStar className="mt-1 shrink-0" aria-hidden /> आपको यह काम काफ़ी आता है — छोटे आकलन (RPL) से सीधा प्रमाणपत्र भी मिल सकता है।
            </p>
          )}
        </Card>

        {centre && (
          <Card title="सेंटर">
            <p className="text-lg font-semibold" translate="no">{centre.name}</p>
            <p className="flex items-center gap-1 text-base text-[var(--text-muted)]">
              <FiMapPin aria-hidden /> {block}, {district?.nameHi} · {centre.type}
              {rec ? ` · लगभग ${Math.max(1, Math.round(rec.distanceKm))} किमी` : ""}
            </p>
            {centre.womenOnlyBatch && <p className="mt-2 flex items-center gap-1 text-base"><FiUsers aria-hidden /> महिलाओं का अलग बैच</p>}
            {centre.accessible && <p className="mt-1 text-base">दिव्यांगजन के लिए सुविधाजनक</p>}
            {mapUrl && (
              <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 rounded-xl border-2 border-[var(--ks-primary)] px-4 py-2 text-base font-semibold text-[var(--ks-primary)]">
                <FiMapPin aria-hidden /> नक्शे पर देखें <FiExternalLink aria-hidden />
              </a>
            )}
            {centre.sample && <p className="mt-3 text-xs text-[var(--text-subtle)]">डेमो सेंटर — असली सेंटर की जानकारी Skill India Digital Hub से आएगी।</p>}
          </Card>
        )}

        <Card title="मदद और योजनाएँ">
          <ul className="space-y-2 text-base">
            {schemes.map((s) => (
              <li key={s.id}>
                <b>{s.name}</b>
                <span className="block text-[var(--text-muted)]">{s.hi}</span>
              </li>
            ))}
          </ul>
          {consultant && (
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-[var(--surface-muted)] px-3 py-2">
              <FiBriefcase className="mt-1 shrink-0" aria-hidden />
              <span>अपना काम शुरू करने में मदद: <b translate="no">{consultant.name}</b> — कर्ज़ (मुद्रा, NSFDC) और कागज़ात में।</span>
            </p>
          )}
        </Card>

        <Card title="आधिकारिक जानकारी">
          <p className="text-base text-[var(--text-muted)]">
            इस कोर्स का नाम <b translate="no">{course.name}</b> लिखकर यहाँ खोजें:
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href="https://www.skillindiadigital.gov.in/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-xl bg-[var(--ks-primary)] px-4 py-2 text-base font-semibold text-white">
              Skill India Digital Hub <FiExternalLink aria-hidden />
            </a>
            <a href="https://www.nqr.gov.in/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-xl border-2 border-[var(--ks-primary)] px-4 py-2 text-base font-semibold text-[var(--ks-primary)]">
              NSQF रजिस्टर (NQR) <FiExternalLink aria-hidden />
            </a>
          </div>
          {!course.verified && <p className="mt-3 text-xs text-[var(--text-subtle)]">कोर्स का स्तर, अवधि और कमाई अभी अनुमान हैं — आधिकारिक सूची से मिलाएँ।</p>}
        </Card>
      </div>
    </div>
  );
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[var(--surface-muted)] p-3">
      <p className="flex items-center gap-1 text-sm text-[var(--text-muted)]">{icon} {label}</p>
      <p className="mt-1 text-base font-semibold">{value}</p>
    </div>
  );
}

export default function CoursePage() {
  return (
    <Suspense fallback={null}>
      <CourseDetail />
    </Suspense>
  );
}
