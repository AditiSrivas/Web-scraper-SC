import * as XLSX from "xlsx";
import { promisePool } from "@/lib/async";
import { generateEmailFromProspect } from "@/lib/llm";
import { buildProspectFromScrapedRole } from "@/lib/prospect";
import { scrapedRowsToCsv } from "@/lib/scrape-csv";
import { rememberRoleFingerprints, splitNewRoleFingerprints } from "@/lib/scrape-state";
import { scrapeCompanyJobs } from "@/lib/scraper";
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

function isCompanyRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function parseRoles(input: string): string[] {
  return input
    .split(/[\n,]/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);
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

    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(Buffer.from(bytes), { type: "buffer" });
    if (!workbook.SheetNames.length) {
      return Response.json({ error: "Company workbook has no sheets." }, { status: 400 });
    }
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const records = XLSX.utils.sheet_to_json(firstSheet, { defval: "" }).filter(isCompanyRecord);

    const candidates = records
      .map((r) => ({
        companyName: String(r["Company Name"] ?? r["company"] ?? "").trim(),
        website: String(r["Website"] ?? r["website"] ?? "").trim()
      }))
      .filter((r) => r.website)
      .slice(0, companyLimit);

    const chunks = await promisePool(candidates, siteConcurrency, async (c) =>
      scrapeCompanyJobs({
        companyName: c.companyName,
        website: c.website,
        targetRoles,
        maxPagesPerSite,
        useAiMapping,
        llmOptions
      })
    );

    const detectedRows: ScrapedJobRow[] = chunks.flat();
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
        durationMs: Date.now() - started
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scrape error";
    return Response.json({ error: message }, { status: 500 });
  }
}
