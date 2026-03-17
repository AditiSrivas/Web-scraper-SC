import { ScrapedJobRow } from "@/lib/types";

const headers: Array<{ key: keyof ScrapedJobRow; label: string }> = [
  { key: "companyName", label: "company_name" },
  { key: "website", label: "website" },
  { key: "pageUrl", label: "page_url" },
  { key: "jobTitle", label: "job_title" },
  { key: "jobDescription", label: "job_description" },
  { key: "roleSnippet", label: "role_snippet" },
  { key: "roleLocationText", label: "role_location_text" },
  { key: "roleLocationBucket", label: "role_location_bucket" },
  { key: "requiredTechnologies", label: "required_technologies" },
  { key: "consultantEmail", label: "consultant_email" },
  { key: "contactInformation", label: "contact_information" },
  { key: "aiMatchedTargetRole", label: "ai_matched_target_role" },
  { key: "aiMatchReason", label: "ai_match_reason" },
  { key: "generatedSubject", label: "generated_subject" },
  { key: "generatedEmailBody", label: "generated_email_body" },
  { key: "generatedToneNotes", label: "generated_tone_notes" },
  { key: "roleFingerprint", label: "role_fingerprint" },
  { key: "isNewRole", label: "is_new_role" }
];

function escape(value: string): string {
  if (!value) return "";
  if (value.includes(",") || value.includes("\n") || value.includes('"')) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function scrapedRowsToCsv(rows: ScrapedJobRow[]): string {
  const head = headers.map((h) => h.label).join(",");
  const lines = rows.map((row) => headers.map((h) => escape(String(row[h.key] ?? ""))).join(","));
  return [head, ...lines].join("\n");
}
