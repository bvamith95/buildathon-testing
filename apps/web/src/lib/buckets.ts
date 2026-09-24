// Citizenship -> bucket resolution (client-side, architecture.md §5).
//
// Real IRCC data researched 2026-09-24 (eTA-eligible list, biometrics
// exemptions, and the Designated Countries/Territories medical-exam
// table fetched directly from canada.ca) for a representative set of
// UBC's actual top source countries (China, India, USA, Iran per UBC's
// own enrolment report) plus other common ones. This is NOT exhaustive
// across all ~190 citizenships — an unlisted country falls back to
// DEFAULT_BUCKET, which is deliberately the same signature as the one
// real published pilot guide, so unlisted citizenships still resolve to
// real content rather than the "unmatched signature" fallback (SAA-22).
//
// funds_evidence and currency_corridor are coarser simplifications (see
// docs/prd.md's bucket table) without an equally authoritative single
// source — flagged here rather than presented as equally verified.

export type EntryDocument = "eta" | "visa_required";
export type Biometrics = "required" | "exempt";
export type MedicalExam = "required" | "not_required";
export type FundsEvidence = "standard" | "country_programme_variant";
export type CurrencyCorridor = "major" | "restricted";

export interface BucketSignature {
  entry_document: EntryDocument;
  biometrics: Biometrics;
  medical_exam: MedicalExam;
  funds_evidence: FundsEvidence;
  currency_corridor: CurrencyCorridor;
}

export function signatureString(b: BucketSignature): string {
  return [
    b.entry_document,
    b.biometrics,
    b.medical_exam,
    b.funds_evidence,
    b.currency_corridor,
  ].join("-");
}

// Same signature as pipeline/run_pilot.py's PILOT_BUCKET — the one
// bucket with a real published guide today.
export const DEFAULT_BUCKET: BucketSignature = {
  entry_document: "visa_required",
  biometrics: "required",
  medical_exam: "required",
  funds_evidence: "country_programme_variant",
  currency_corridor: "restricted",
};

export interface CitizenshipEntry {
  code: string;
  label: string;
  aliases: string[];
  bucket: BucketSignature;
}

export const CITIZENSHIPS: CitizenshipEntry[] = [
  { code: "CN", label: "China", aliases: ["PRC", "Mainland China"], bucket: { entry_document: "visa_required", biometrics: "required", medical_exam: "required", funds_evidence: "country_programme_variant", currency_corridor: "restricted" } },
  { code: "IN", label: "India", aliases: ["Bharat"], bucket: { entry_document: "visa_required", biometrics: "required", medical_exam: "required", funds_evidence: "country_programme_variant", currency_corridor: "restricted" } },
  { code: "US", label: "United States", aliases: ["USA", "US", "America"], bucket: { entry_document: "eta", biometrics: "exempt", medical_exam: "not_required", funds_evidence: "standard", currency_corridor: "major" } },
  { code: "IR", label: "Iran", aliases: ["Persia"], bucket: { entry_document: "visa_required", biometrics: "required", medical_exam: "not_required", funds_evidence: "country_programme_variant", currency_corridor: "restricted" } },
  { code: "KR", label: "South Korea", aliases: ["Korea", "Republic of Korea"], bucket: { entry_document: "eta", biometrics: "required", medical_exam: "required", funds_evidence: "standard", currency_corridor: "major" } },
  { code: "HK", label: "Hong Kong", aliases: ["Hong Kong SAR"], bucket: { entry_document: "eta", biometrics: "required", medical_exam: "required", funds_evidence: "standard", currency_corridor: "major" } },
  { code: "NG", label: "Nigeria", aliases: [], bucket: { entry_document: "visa_required", biometrics: "required", medical_exam: "required", funds_evidence: "country_programme_variant", currency_corridor: "restricted" } },
  { code: "FR", label: "France", aliases: [], bucket: { entry_document: "eta", biometrics: "required", medical_exam: "not_required", funds_evidence: "standard", currency_corridor: "major" } },
  { code: "VN", label: "Vietnam", aliases: ["Viet Nam"], bucket: { entry_document: "visa_required", biometrics: "required", medical_exam: "required", funds_evidence: "country_programme_variant", currency_corridor: "restricted" } },
  { code: "MX", label: "Mexico", aliases: [], bucket: { entry_document: "visa_required", biometrics: "required", medical_exam: "not_required", funds_evidence: "standard", currency_corridor: "major" } },
  { code: "BR", label: "Brazil", aliases: [], bucket: { entry_document: "visa_required", biometrics: "required", medical_exam: "required", funds_evidence: "standard", currency_corridor: "major" } },
  { code: "BD", label: "Bangladesh", aliases: [], bucket: { entry_document: "visa_required", biometrics: "required", medical_exam: "required", funds_evidence: "country_programme_variant", currency_corridor: "restricted" } },
  { code: "JP", label: "Japan", aliases: [], bucket: { entry_document: "eta", biometrics: "required", medical_exam: "not_required", funds_evidence: "standard", currency_corridor: "major" } },
  { code: "GB", label: "United Kingdom", aliases: ["UK", "Britain", "Great Britain"], bucket: { entry_document: "eta", biometrics: "required", medical_exam: "not_required", funds_evidence: "standard", currency_corridor: "major" } },
  { code: "PK", label: "Pakistan", aliases: [], bucket: { entry_document: "visa_required", biometrics: "required", medical_exam: "required", funds_evidence: "country_programme_variant", currency_corridor: "restricted" } },
  { code: "PH", label: "Philippines", aliases: [], bucket: { entry_document: "visa_required", biometrics: "required", medical_exam: "required", funds_evidence: "country_programme_variant", currency_corridor: "restricted" } },
  { code: "DE", label: "Germany", aliases: [], bucket: { entry_document: "eta", biometrics: "required", medical_exam: "not_required", funds_evidence: "standard", currency_corridor: "major" } },
  { code: "ID", label: "Indonesia", aliases: [], bucket: { entry_document: "visa_required", biometrics: "required", medical_exam: "required", funds_evidence: "country_programme_variant", currency_corridor: "restricted" } },
  { code: "SA", label: "Saudi Arabia", aliases: ["KSA"], bucket: { entry_document: "visa_required", biometrics: "required", medical_exam: "not_required", funds_evidence: "standard", currency_corridor: "major" } },
  { code: "TW", label: "Taiwan", aliases: [], bucket: { entry_document: "eta", biometrics: "required", medical_exam: "not_required", funds_evidence: "standard", currency_corridor: "major" } },
  { code: "AU", label: "Australia", aliases: [], bucket: { entry_document: "eta", biometrics: "required", medical_exam: "not_required", funds_evidence: "standard", currency_corridor: "major" } },
];

export function searchCitizenships(query: string): CitizenshipEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return CITIZENSHIPS;
  return CITIZENSHIPS.filter(
    (c) =>
      c.label.toLowerCase().includes(q) ||
      c.code.toLowerCase() === q ||
      c.aliases.some((a) => a.toLowerCase().includes(q))
  );
}

export function resolveBucket(code: string): BucketSignature {
  const entry = CITIZENSHIPS.find((c) => c.code === code);
  return entry ? entry.bucket : DEFAULT_BUCKET;
}
