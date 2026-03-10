import { GeneratedRow } from "@/lib/types";

const HEADERS: Array<{ key: keyof GeneratedRow; label: string }> = [
  { key: "rowNumber", label: "row_number" },
  { key: "personName", label: "person_name" },
  { key: "companyName", label: "company_name" },
  { key: "country", label: "country" },
  { key: "detectedEmail", label: "detected_email" },
  { key: "linkedinId", label: "linkedin_id" },
  { key: "subject", label: "subject" },
  { key: "emailBody", label: "email_body" },
  { key: "toneNotes", label: "tone_notes" }
];

function esc(value: string | number): string {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes("\n") || str.includes('"')) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

export function rowsToCsv(rows: GeneratedRow[]): string {
  const header = HEADERS.map((h) => h.label).join(",");
  const lines = rows.map((row) => HEADERS.map((h) => esc(row[h.key])).join(","));
  return [header, ...lines].join("\n");
}
