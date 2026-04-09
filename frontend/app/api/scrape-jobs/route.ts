import { promisePool } from "@/lib/async";
import { generateEmailFromProspect } from "@/lib/llm";
import { buildProspectFromScrapedRole } from "@/lib/prospect";
import { scrapedRowsToCsv } from "@/lib/scrape-csv";
import { getRowWindow, rememberRoleFingerprints, setRowCursor, splitNewRoleFingerprints } from "@/lib/scrape-state";
import { scrapeCompanyJobs } from "@/lib/scraper";
import { lookupField, parseSpreadsheetFile } from "@/lib/tabular";
import { LLMProvider, LlmRunOptions, ScrapedJobRow } from "@/lib/types";

export const runtime = "nodejs";

function num(value: FormDataEntryValue | null, fallback: number): number {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function provider(value: FormDataEntryValue | null): LLMProvider | undefined {
  const normalized = String(value ?? "").toLowerCase().trim();
  if (normalized === "google" || normalized === "openai" || normalized === "anthropic") return normalized;
  return undefined;
}

function parseRoles(input: string): string[] {
  return input
    .split(/[\n,]/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);
}

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
  "live.com",
  "proton.me",
  "protonmail.com"
]);

function extractFirstEmail(text: string): string {
  const match = String(text ?? "").match(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
  return match?.[0] ?? "";
}

function inferWebsiteFromRow(raw: Record<string, unknown>): string {
  const explicitWebsite = String(
    lookupField(raw, ["Website", "Company Website", "Current Company Website", "URL", "Site", "Company Url"]) ?? ""
  ).trim();

  if (explicitWebsite) {
    return explicitWebsite;
  }

  const contactText = String(
    lookupField(raw, ["Person contact Details", "Contact Details", "Email", "Contact", "Work Email"]) ?? ""
  ).trim();
  const email = extractFirstEmail(contactText).toLowerCase();

  if (email) {
    const domain = email.split("@")[1] ?? "";
    if (domain && !PERSONAL_EMAIL_DOMAINS.has(domain)) {
      return `https://${domain}`;
    }
  }

  return "";
}

export async function POST(request: Request): Promise<Response> {
  const started = Date.now();
  try {
    const form = await request.formData();
    const file = form.get("companyFile");

    if (!(file instanceof File)) {
      return Response.json({ error: "Missing company website file (CSV/XLSX)." }, { status: 400 });
    }

    const companyLimit = Math.max(1, Math.min(num(form.get("companyLimit"), 15), 200));
    const siteConcurrency = Math.max(1, Math.min(num(form.get("siteConcurrency"), 4), 10));
    const maxPagesPerSite = Math.max(1, Math.min(num(form.get("maxPagesPerSite"), 4), 12));
    const useAiMapping = String(form.get("useAiMapping") ?? "true").toLowerCase() !== "false";

    const llmOptions: LlmRunOptions = {
      provider: provider(form.get("provider")),
      modelOverride: String(form.get("model") ?? "").trim() || undefined,
      temperature: num(form.get("temperature"), 0.2),
      maxTokens: num(form.get("maxTokens"), 180),
      retries: Math.max(1, Math.min(num(form.get("retries"), 2), 4)),
      fastMode: true
    };

    const targetRoles = parseRoles(String(form.get("targetRoles") ?? ""));

    const parsed = await parseSpreadsheetFile(file);
    const { startIndex, endIndex, nextIndex, wrapped } = await getRowWindow(parsed.fileKey, parsed.rows.length, companyLimit);
    const selectedRows = parsed.rows.slice(startIndex, endIndex);

    const candidateRows = selectedRows.map((entry) => ({
      sourceRowNumber: entry.rowNumber,
      companyName: String(lookupField(entry.raw, ["Company Name", "Company", "Current Company Name"]) ?? "").trim(),
      website: inferWebsiteFromRow(entry.raw),
      contactInformation: String(
        lookupField(entry.raw, ["Person contact Details", "Contact Details", "Email", "Contact", "Work Email"]) ?? ""
      ).trim()
    }));

    const candidates = candidateRows.filter((r) => r.website);
    const missingWebsiteRows: ScrapedJobRow[] = candidateRows
      .filter((r) => !r.website)
      .map((r) => ({
        sourceRowNumber: r.sourceRowNumber,
        companyName: r.companyName,
        website: "",
        pageUrl: "",
        jobTitle: "",
        jobDescription: "",
        roleSnippet: "",
        roleLocationText: "",
        roleLocationBucket: "Unknown",
        requiredTechnologies: "",
        consultantEmail: extractFirstEmail(r.contactInformation),
        contactInformation: r.contactInformation,
        aiMatchedTargetRole: "",
        aiMatchReason: "No company website or corporate email domain could be derived from this row",
        generatedSubject: "",
        generatedEmailBody: "",
        generatedToneNotes: "",
        roleFingerprint: `missing-website-${parsed.fileKey}-${r.sourceRowNumber}`,
        isNewRole: false
      }));

    const chunks = await promisePool(candidates, siteConcurrency, async (c) =>
      scrapeCompanyJobs({
        sourceRowNumber: c.sourceRowNumber,
        companyName: c.companyName,
        website: c.website,
        targetRoles,
        maxPagesPerSite,
        useAiMapping,
        llmOptions
      })
    );

    const detectedRows: ScrapedJobRow[] = [...chunks.flat(), ...missingWebsiteRows];
    const { newFingerprints, skippedCount } = await splitNewRoleFingerprints(detectedRows.map((row) => row.roleFingerprint));

    const newRows = detectedRows.filter((row) => newFingerprints.has(row.roleFingerprint));
    const generatedNewRows = await promisePool(newRows, Math.min(siteConcurrency, 4), async (row) => {
      if (!row.jobTitle && !row.roleSnippet) {
        return row;
      }

      const generated = await generateEmailFromProspect(buildProspectFromScrapedRole(row), {
        ...llmOptions,
        maxTokens: Math.max(180, llmOptions.maxTokens ?? 180),
        fastMode: true
      });

      return {
        ...row,
        generatedSubject: generated.subject,
        generatedEmailBody: generated.body,
        generatedToneNotes: generated.toneNotes,
        isNewRole: true
      };
    });

    const newRowMap = new Map(generatedNewRows.map((row) => [row.roleFingerprint, row]));
    const rows = detectedRows.map((row) => newRowMap.get(row.roleFingerprint) ?? { ...row, isNewRole: false });

    await rememberRoleFingerprints(generatedNewRows.map((row) => row.roleFingerprint));
    await setRowCursor(parsed.fileKey, nextIndex);
    const csv = scrapedRowsToCsv(rows);

    const indiaRoles = rows.filter((r) => r.roleLocationBucket === "India").length;
    const abroadRoles = rows.filter((r) => r.roleLocationBucket === "Abroad").length;
    const emailHits = rows.filter((r) => r.consultantEmail).length;

    return Response.json({
      count: rows.length,
      rows,
      csv,
      summary: {
        companiesProcessed: candidates.length,
        detectedRoles: detectedRows.length,
        newRoles: generatedNewRows.length,
        skippedExistingRoles: skippedCount,
        indiaRoles,
        abroadRoles,
        emailHits,
        startRow: selectedRows[0]?.rowNumber ?? 0,
        endRow: selectedRows[selectedRows.length - 1]?.rowNumber ?? 0,
        nextRow: nextIndex < parsed.rows.length ? parsed.rows[nextIndex]?.rowNumber ?? nextIndex + 2 : parsed.rows.length + 1,
        wrappedToStart: wrapped,
        durationMs: Date.now() - started
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scrape error";
    return Response.json({ error: message }, { status: 500 });
  }
}
