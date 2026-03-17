import { createHash } from "node:crypto";
import { aiMapRoleToTarget } from "@/lib/llm";
import { promisePool } from "@/lib/async";
import { LlmRunOptions, ScrapedJobRow } from "@/lib/types";

const JOB_LINK_WORDS = ["career", "careers", "job", "jobs", "opportunity", "vacanc", "join-us", "openings"];
const JOB_TITLE_HINTS = /\b(hiring|consultant|engineer|developer|architect|manager|sap|oracle|erp|analyst|lead|specialist|admin|support|finance|hris)\b/i;
const LOCATION_HINTS =
  /\b(india|bangalore|bengaluru|hyderabad|pune|chennai|noida|gurgaon|mumbai|delhi|remote|uk|usa|united states|canada|europe|germany|france|australia|dubai|uae|singapore)\b/i;
const TECHNOLOGY_HINTS = [
  "sap",
  "abap",
  "fico",
  "s/4hana",
  "hana",
  "successfactors",
  "ariba",
  "mm",
  "sd",
  "pp",
  "eWM",
  "tm",
  "crm",
  "oracle",
  "erp",
  "java",
  "python",
  "salesforce",
  "workday"
];
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

interface RoleCandidate {
  title: string;
  description: string;
  snippet: string;
  locationText: string;
  technologies: string;
}

function normalizeUrl(url: string): string {
  const trimmed = (url || "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
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

function extractPhones(text: string): string[] {
  const matches = text.match(/(?:\+?\d[\d\s\-()]{7,}\d)/g) || [];
  return Array.from(new Set(matches.map((value) => value.replace(/\s+/g, " ").trim()).filter((value) => value.length >= 10)));
}

function normalizeWhitespace(value: string): string {
  return decodeEntities(stripHtml(value)).replace(/\s+/g, " ").trim();
}

function extractTechnologies(text: string): string {
  const lower = text.toLowerCase();
  const matches = TECHNOLOGY_HINTS.filter((keyword) => lower.includes(keyword.toLowerCase()));
  return Array.from(new Set(matches)).join(", ");
}

function locationBucket(text: string): "India" | "Abroad" | "Unknown" {
  const lower = text.toLowerCase();
  if (INDIA_HINTS.some((hint) => lower.includes(hint))) return "India";
  if (/\b(uk|usa|united states|canada|europe|germany|france|australia|dubai|uae|singapore|remote)\b/i.test(lower)) return "Abroad";
  return "Unknown";
}

function extractRoleCandidates(html: string): RoleCandidate[] {
  const blocks = html.match(/<(article|section|div|li|tr|a)[^>]*>[\s\S]*?<\/\1>/gi) || [];
  const candidates: RoleCandidate[] = [];

  for (const block of blocks) {
    const text = normalizeWhitespace(block);
    if (text.length < 12 || text.length > 900) continue;
    if (!JOB_TITLE_HINTS.test(text)) continue;

    const title = text
      .split(/[\n|•]/)
      .map((part) => part.trim())
      .find((part) => part.length >= 6 && part.length <= 120 && JOB_TITLE_HINTS.test(part));

    if (!title) continue;

    const locationMatch = text.match(new RegExp(`.{0,40}${LOCATION_HINTS.source}.{0,40}`, "i"));
    candidates.push({
      title,
      description: text,
      snippet: text.slice(0, 420),
      locationText: locationMatch?.[0]?.trim() || "",
      technologies: extractTechnologies(text)
    });
  }

  const deduped = new Map<string, RoleCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.title.toLowerCase()}|${candidate.locationText.toLowerCase()}`;
    if (!deduped.has(key)) deduped.set(key, candidate);
  }
  return Array.from(deduped.values()).slice(0, 25);
}

function fingerprintRole(companyName: string, website: string, pageUrl: string, title: string, snippet: string): string {
  return createHash("sha1")
    .update([companyName, website, pageUrl, title.toLowerCase(), snippet.slice(0, 180).toLowerCase()].join("|"))
    .digest("hex");
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
  const allPhones = new Set<string>();
  const rows: ScrapedJobRow[] = [];

  for (const page of pageHtmls) {
    if (!page.html) continue;

    const emails = extractEmails(page.html);
    const phones = extractPhones(page.html);
    emails.forEach((email) => allEmails.add(email));
    phones.forEach((phone) => allPhones.add(phone));

    const candidates = extractRoleCandidates(page.html);
    for (const candidate of candidates) {
      const candidateEmails = extractEmails(candidate.description);
      const candidatePhones = extractPhones(candidate.description);
      const contactParts = [
        ...candidateEmails,
        ...candidatePhones,
        ...Array.from(allEmails).slice(0, 3),
        ...Array.from(allPhones).slice(0, 2)
      ];

      rows.push({
        companyName: params.companyName,
        website,
        pageUrl: page.url,
        jobTitle: candidate.title,
        jobDescription: candidate.description,
        roleSnippet: candidate.snippet,
        roleLocationText: candidate.locationText,
        roleLocationBucket: locationBucket(`${candidate.title} ${candidate.locationText} ${candidate.snippet}`),
        requiredTechnologies: candidate.technologies,
        consultantEmail: candidateEmails[0] || emails[0] || Array.from(allEmails)[0] || "",
        contactInformation: Array.from(new Set(contactParts)).join(" | "),
        aiMatchedTargetRole: "",
        aiMatchReason: "",
        generatedSubject: "",
        generatedEmailBody: "",
        generatedToneNotes: "",
        roleFingerprint: fingerprintRole(params.companyName, website, page.url, candidate.title, candidate.snippet),
        isNewRole: true
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
        jobDescription: "",
        roleSnippet: "",
        roleLocationText: "",
        roleLocationBucket: "Unknown",
        requiredTechnologies: "",
        consultantEmail: Array.from(allEmails)[0] || "",
        contactInformation: [...Array.from(allEmails), ...Array.from(allPhones)].join(" | "),
        aiMatchedTargetRole: "",
        aiMatchReason: "No role-like listing detected",
        generatedSubject: "",
        generatedEmailBody: "",
        generatedToneNotes: "",
        roleFingerprint: fingerprintRole(params.companyName, website, website, "", "no-role-detected"),
        isNewRole: true
      }
    ];
  }

  if (params.useAiMapping && params.targetRoles.length > 0) {
    const mapped = await promisePool(rows, 4, async (row) => {
      const m = await aiMapRoleToTarget(
        row.jobTitle,
        `${row.jobTitle}\n${row.roleSnippet}\n${row.requiredTechnologies}\n${row.pageUrl}`,
        params.targetRoles,
        params.llmOptions
      );
      return { ...row, aiMatchedTargetRole: m.matchedRole, aiMatchReason: m.reason };
    });
    return mapped;
  }

  return rows;
}
