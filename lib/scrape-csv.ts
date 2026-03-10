import { ScrapedJobRow } from "@/lib/types";

const headers: Array<{ key: keyof ScrapedJobRow; label: string }> = [
  { key: "companyName", label: "company_name" },
  { key: "website", label: "website" },
  { key: "pageUrl", label: "page_url" },
  { key: "jobTitle", label: "job_title" },
  { key: "roleLocationBucket", label: "role_location_bucket" },
  { key: "consultantEmail", label: "consultant_email" },
  { key: "aiMatchedTargetRole", label: "ai_matched_target_role" },
  { key: "aiMatchReason", label: "ai_match_reason" }
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
