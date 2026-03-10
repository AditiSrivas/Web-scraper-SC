import { aiMapRoleToTarget } from "@/lib/llm";
import { promisePool } from "@/lib/async";
import { LlmRunOptions, ScrapedJobRow } from "@/lib/types";

const JOB_LINK_WORDS = ["career", "careers", "job", "jobs", "opportunity", "vacanc", "join-us", "openings"];

const INDIA_HINTS = [
  "india",
  "bangalore",
  "bengaluru",
  "hyderabad",
  "pune",
  "chennai",
  "noida",
  "gurgaon",
  "mumbai",
  "delhi",
  "remote india"
];

function normalizeUrl(url: string): string {
  const trimmed = (url || "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function stripHtml(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function absoluteUrl(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return "";
  }
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const regex = /<a[^>]+href=["']([^"'#]+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) !== null) {
    const href = (match[1] || "").trim();
    if (!href || href.startsWith("mailto:")) continue;
    const abs = absoluteUrl(href, baseUrl);
    if (!abs) continue;

    const lower = abs.toLowerCase();
    if (JOB_LINK_WORDS.some((word) => lower.includes(word))) {
      links.push(abs);
    }
  }

  return Array.from(new Set(links)).slice(0, 12);
}

function extractEmails(text: string): string[] {
  const matches = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  return Array.from(new Set(matches));
}

function extractJobTitles(html: string): string[] {
  const blocks = html.match(/<(h1|h2|h3|h4|li|a|p)[^>]*>[\s\S]*?<\/\1>/gi) || [];
  const clean = blocks
    .map((b) => stripHtml(b).trim())
    .filter((line) => line.length > 5 && line.length < 110)
    .filter((line) => /\b(hiring|consultant|engineer|developer|architect|manager|sap|oracle|erp|analyst|lead)\b/i.test(line));

  const uniq = Array.from(new Set(clean));
  return uniq.slice(0, 20);
}

function locationBucket(text: string): "India" | "Abroad" | "Unknown" {
  const lower = text.toLowerCase();
  if (INDIA_HINTS.some((hint) => lower.includes(hint))) return "India";
  if (/\b(uk|usa|united states|canada|europe|germany|france|australia|dubai|uae|singapore|remote)\b/i.test(lower)) return "Abroad";
  return "Unknown";
}

async function fetchHtml(url: string, timeoutMs = 12000): Promise<string> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; DeepSAPBot/1.0)" } });
    if (!res.ok) return "";
    const type = res.headers.get("content-type") || "";
    if (!type.includes("text/html")) return "";
    return await res.text();
  } catch {
    return "";
  } finally {
    clearTimeout(id);
  }
}

export async function scrapeCompanyJobs(params: {
  companyName: string;
  website: string;
  targetRoles: string[];
  maxPagesPerSite: number;
  useAiMapping: boolean;
  llmOptions?: LlmRunOptions;
}): Promise<ScrapedJobRow[]> {
  const website = normalizeUrl(params.website);
  if (!website) return [];

  const home = await fetchHtml(website);
  if (!home) return [];

  const candidatePages = [website, ...extractLinks(home, website)].slice(0, Math.max(1, params.maxPagesPerSite));
  const pageHtmls = await promisePool(candidatePages, 3, async (url) => ({ url, html: await fetchHtml(url) }));

  const allEmails = new Set<string>();
  const rows: ScrapedJobRow[] = [];

  for (const page of pageHtmls) {
    if (!page.html) continue;

    const emails = extractEmails(page.html);
    emails.forEach((email) => allEmails.add(email));

    const titles = extractJobTitles(page.html);
    const snippet = stripHtml(page.html).slice(0, 1800);

    for (const title of titles) {
      const bucket = locationBucket(`${title} ${snippet}`);
      rows.push({
        companyName: params.companyName,
        website,
        pageUrl: page.url,
        jobTitle: title,
        roleLocationBucket: bucket,
        consultantEmail: emails[0] || Array.from(allEmails)[0] || "",
        aiMatchedTargetRole: "",
        aiMatchReason: ""
      });
    }
  }

  if (rows.length === 0) {
    return [
      {
        companyName: params.companyName,
        website,
        pageUrl: website,
        jobTitle: "",
        roleLocationBucket: "Unknown",
        consultantEmail: Array.from(allEmails)[0] || "",
        aiMatchedTargetRole: "",
        aiMatchReason: "No role-like listing detected"
      }
    ];
  }

  if (params.useAiMapping && params.targetRoles.length > 0) {
    const mapped = await promisePool(rows, 4, async (row) => {
      const m = await aiMapRoleToTarget(row.jobTitle, `${row.jobTitle} ${row.pageUrl}`, params.targetRoles, params.llmOptions);
      return { ...row, aiMatchedTargetRole: m.matchedRole, aiMatchReason: m.reason };
    });
    return mapped;
  }

  return rows;
}
