import { rowsToCsv } from "@/lib/csv";
import { promisePool } from "@/lib/async";
import { generateEmailFromProspect } from "@/lib/llm";
import { extractEmail, normalizeProspect } from "@/lib/prospect";
import { parseSpreadsheetFile } from "@/lib/tabular";
import { GeneratedRow, LLMProvider, LlmRunOptions } from "@/lib/types";

export const runtime = "nodejs";

function num(value: FormDataEntryValue | null, fallback: number): number {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseProvider(value: FormDataEntryValue | null): LLMProvider | undefined {
  const normalized = String(value ?? "").toLowerCase().trim();
  if (normalized === "google" || normalized === "openai" || normalized === "anthropic") return normalized;
  return undefined;
}

export async function POST(request: Request): Promise<Response> {
  const started = Date.now();

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const limitInput = num(formData.get("limit"), 0);
    const concurrency = Math.max(1, Math.min(num(formData.get("concurrency"), 4), 12));

    const llmOptions: LlmRunOptions = {
      provider: parseProvider(formData.get("provider")),
      modelOverride: String(formData.get("model") ?? "").trim() || undefined,
      temperature: num(formData.get("temperature"), Number(process.env.LLM_TEMPERATURE ?? "0.25")),
      maxTokens: num(formData.get("maxTokens"), Number(process.env.MAX_TOKENS ?? "300")),
      retries: Math.max(1, Math.min(num(formData.get("retries"), Number(process.env.LLM_MAX_RETRIES ?? "2")), 5)),
      fastMode: String(formData.get("fastMode") ?? "true").toLowerCase() !== "false"
    };

    if (!(file instanceof File)) {
      return Response.json({ error: "Missing CSV/XLSX file." }, { status: 400 });
    }

    const parsed = await parseSpreadsheetFile(file);
    const bounded = limitInput > 0 ? parsed.rows.slice(0, limitInput) : parsed.rows;

    const validRows = bounded
      .map((entry) => ({ ...entry, prospect: normalizeProspect(entry.raw) }))
      .filter((entry) => entry.prospect.personName || entry.prospect.companyName || entry.prospect.activitiesDetails);

    const durations: number[] = [];

    const output = await promisePool(validRows, concurrency, async (entry): Promise<GeneratedRow> => {
      const t0 = Date.now();
      const generated = await generateEmailFromProspect(entry.prospect, llmOptions);
      durations.push(Date.now() - t0);

      return {
        rowNumber: entry.rowNumber,
        personName: entry.prospect.personName,
        companyName: entry.prospect.companyName,
        country: entry.prospect.country,
        detectedEmail: extractEmail(entry.prospect.contactDetails),
        linkedinId: entry.prospect.linkedinId,
        subject: generated.subject,
        emailBody: generated.body,
        toneNotes: generated.toneNotes
      };
    });

    const csv = rowsToCsv(output);
    const totalMs = Date.now() - started;
    const avgMsPerRow = output.length ? Math.round(durations.reduce((a, b) => a + b, 0) / output.length) : 0;

    return Response.json({
      count: output.length,
      rows: output,
      csv,
      generatedAt: new Date().toISOString(),
      perf: {
        totalMs,
        avgMsPerRow,
        rowsPerMinute: output.length ? Math.round((output.length * 60000) / Math.max(totalMs, 1)) : 0,
        concurrency,
        options: llmOptions
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    return Response.json({ error: message }, { status: 500 });
  }
}
