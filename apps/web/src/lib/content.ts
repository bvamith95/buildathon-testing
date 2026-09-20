// Landing page content. The source strip's date is a placeholder until the
// content pipeline (pipeline/) publishes a real manifest with per-source
// last_verified dates (docs/architecture.md §3) — wire this up in Week 2.

export const SCOPE_ITEMS = [
  "Study permit & biometrics",
  "Medical exam & port of entry",
  "Tuition payment & transfers",
  "Newcomer banking & credit",
  "Provincial & interim health coverage",
  "Social Insurance Number (SIN)",
] as const;

export const HOUSING_LINKS = [
  { label: "UBC Student Housing", url: "https://you.ubc.ca/student-housing/" },
  {
    label: "UBC Facebook roommates group",
    url: "https://www.facebook.com/groups/ubcroommates/",
  },
] as const;

export const SOURCE_ORGANISATIONS = ["UBC", "IRCC", "Government of BC", "CRA"] as const;

// Placeholder — replace with the real content manifest's last-checked date
// once the pipeline has published at least one reviewed variant.
export const CONTENT_LAST_CHECKED = "2026-09-20";
