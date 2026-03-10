"use client";

import { useMemo, useState } from "react";

type GeneratedRow = {
  rowNumber: number;
  personName: string;
  companyName: string;
  country: string;
  detectedEmail: string;
  linkedinId: string;
  subject: string;
  emailBody: string;
  toneNotes: string;
};

type EmailApiResponse = {
  count: number;
  rows: GeneratedRow[];
  csv: string;
  generatedAt: string;
  perf?: {
    totalMs: number;
    avgMsPerRow: number;
    rowsPerMinute: number;
    concurrency: number;
  };
  error?: string;
};

type ScrapeRow = {
  companyName: string;
  website: string;
  pageUrl: string;
  jobTitle: string;
  roleLocationBucket: string;
  consultantEmail: string;
  aiMatchedTargetRole: string;
  aiMatchReason: string;
};

type ScrapeApiResponse = {
  count: number;
  rows: ScrapeRow[];
  csv: string;
  summary?: {
    companiesProcessed: number;
    indiaRoles: number;
    abroadRoles: number;
    emailHits: number;
    durationMs: number;
  };
  error?: string;
};

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function HomePage() {
  const [tab, setTab] = useState<"emails" | "scraper">("emails");

  const [file, setFile] = useState<File | null>(null);
  const [limit, setLimit] = useState<number>(6);
  const [concurrency, setConcurrency] = useState<number>(4);
  const [provider, setProvider] = useState<"google" | "openai" | "anthropic">("google");
  const [model, setModel] = useState<string>("");
  const [temperature, setTemperature] = useState<number>(0.2);
  const [maxTokens, setMaxTokens] = useState<number>(220);
  const [fastMode, setFastMode] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [emailData, setEmailData] = useState<EmailApiResponse | null>(null);

  const [companyFile, setCompanyFile] = useState<File | null>(null);
  const [targetRoles, setTargetRoles] = useState("SAP ABAP Consultant, SAP FICO Consultant, SAP SD Consultant");
  const [companyLimit, setCompanyLimit] = useState<number>(12);
  const [siteConcurrency, setSiteConcurrency] = useState<number>(4);
  const [maxPagesPerSite, setMaxPagesPerSite] = useState<number>(4);
  const [useAiMapping, setUseAiMapping] = useState(true);
  const [scrapeLoading, setScrapeLoading] = useState(false);
  const [scrapeError, setScrapeError] = useState("");
  const [scrapeData, setScrapeData] = useState<ScrapeApiResponse | null>(null);

  const generatedAt = useMemo(() => {
    if (!emailData?.generatedAt) return "";
    return new Date(emailData.generatedAt).toLocaleString();
  }, [emailData?.generatedAt]);

  async function handleEmailGenerate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setEmailData(null);

    if (!file) {
      setError("Upload your LinkedIn active roles .xlsx first.");
      return;
    }

    setIsLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("limit", String(limit || 0));
      form.append("concurrency", String(concurrency || 1));
      form.append("provider", provider);
      form.append("model", model.trim());
      form.append("temperature", String(temperature));
      form.append("maxTokens", String(maxTokens));
      form.append("fastMode", String(fastMode));
      form.append("retries", "2");

      const res = await fetch("/api/generate", { method: "POST", body: form });
      const payload = (await res.json()) as EmailApiResponse;
      if (!res.ok || payload.error) throw new Error(payload.error || "Generation failed");
      setEmailData(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected generation error");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleScrape(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setScrapeError("");
    setScrapeData(null);

    if (!companyFile) {
      setScrapeError("Upload the company website list file (CSV/XLSX).");
      return;
    }

    setScrapeLoading(true);
    try {
      const form = new FormData();
      form.append("companyFile", companyFile);
      form.append("targetRoles", targetRoles);
      form.append("companyLimit", String(companyLimit));
      form.append("siteConcurrency", String(siteConcurrency));
      form.append("maxPagesPerSite", String(maxPagesPerSite));
      form.append("provider", provider);
      form.append("model", model.trim());
      form.append("temperature", String(0.2));
      form.append("maxTokens", String(160));
      form.append("useAiMapping", String(useAiMapping));

      const res = await fetch("/api/scrape-jobs", { method: "POST", body: form });
      const payload = (await res.json()) as ScrapeApiResponse;
      if (!res.ok || payload.error) throw new Error(payload.error || "Scrape failed");
      setScrapeData(payload);
    } catch (e) {
      setScrapeError(e instanceof Error ? e.message : "Unexpected scrape error");
    } finally {
      setScrapeLoading(false);
    }
  }

  return (
    <main>
      <section className="hero">
        <h1>Outreach Engine: Generator + Scraper</h1>
        <p>
          Optimized for speed with parallel generation and model/provider switching. Target: 5-6 rows under a minute with fast models and concurrency.
        </p>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="actions" style={{ marginTop: 0 }}>
          <button className={tab === "emails" ? "primary" : "ghost"} type="button" onClick={() => setTab("emails")}>Email Generator</button>
          <button className={tab === "scraper" ? "primary" : "ghost"} type="button" onClick={() => setTab("scraper")}>Website Scraper</button>
        </div>
      </section>

      <div className="grid">
        <section className="card">
          <h3 style={{ marginTop: 0 }}>{tab === "emails" ? "Use Case 1: Personalized Email Generator" : "Use Case 2: Website Roles Scraper + AI Mapping"}</h3>

          <div className="form-row" style={{ marginBottom: 8 }}>
            <label>
              LLM Provider
              <select value={provider} onChange={(e) => setProvider(e.target.value as "google" | "openai" | "anthropic")}>
                <option value="google">google</option>
                <option value="openai">openai</option>
                <option value="anthropic">anthropic</option>
              </select>
            </label>
            <label>
              Model override (optional)
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="e.g. gemini-2.0-flash, gpt-4o-mini" />
            </label>
          </div>

          {tab === "emails" ? (
            <form onSubmit={handleEmailGenerate}>
              <div className="form-row">
                <label>
                  LinkedIn Active Roles (.xlsx)
                  <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </label>
                <label>
                  Max rows
                  <input type="number" min={1} value={limit} onChange={(e) => setLimit(Number(e.target.value || "6"))} />
                </label>
              </div>

              <div className="form-row">
                <label>
                  Concurrency
                  <input type="number" min={1} max={12} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value || "4"))} />
                </label>
                <label>
                  Max tokens
                  <input type="number" min={80} max={600} value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value || "220"))} />
                </label>
              </div>

              <div className="form-row">
                <label>
                  Temperature
                  <input type="number" min={0} max={1} step="0.1" value={temperature} onChange={(e) => setTemperature(Number(e.target.value || "0.2"))} />
                </label>
                <label>
                  Fast mode
                  <select value={String(fastMode)} onChange={(e) => setFastMode(e.target.value === "true")}>
                    <option value="true">true (recommended)</option>
                    <option value="false">false</option>
                  </select>
                </label>
              </div>

              <div className="actions">
                <button className="primary" type="submit" disabled={isLoading}>{isLoading ? "Generating..." : "Generate Emails"}</button>
                {emailData?.csv ? (
                  <button className="ghost" type="button" onClick={() => downloadCsv(emailData.csv, "generated_emails.csv")}>Download CSV</button>
                ) : null}
              </div>

              {emailData?.perf ? (
                <p className="meta">
                  {emailData.count} rows in {Math.round((emailData.perf.totalMs / 1000) * 10) / 10}s | avg {emailData.perf.avgMsPerRow}ms/row | {emailData.perf.rowsPerMinute} rows/min | concurrency {emailData.perf.concurrency}
                  {generatedAt ? ` | ${generatedAt}` : ""}
                </p>
              ) : null}
              {error ? <div className="error">{error}</div> : null}
            </form>
          ) : (
            <form onSubmit={handleScrape}>
              <div className="form-row">
                <label>
                  Company websites file (CSV/XLSX)
                  <input type="file" accept=".csv,.xlsx" onChange={(e) => setCompanyFile(e.target.files?.[0] ?? null)} />
                </label>
                <label>
                  Max companies
                  <input type="number" min={1} max={200} value={companyLimit} onChange={(e) => setCompanyLimit(Number(e.target.value || "12"))} />
                </label>
              </div>

              <label>
                Target roles for AI mapping (comma/newline separated)
                <textarea rows={4} value={targetRoles} onChange={(e) => setTargetRoles(e.target.value)} />
              </label>

              <div className="form-row">
                <label>
                  Site concurrency
                  <input type="number" min={1} max={10} value={siteConcurrency} onChange={(e) => setSiteConcurrency(Number(e.target.value || "4"))} />
                </label>
                <label>
                  Max pages per site
                  <input type="number" min={1} max={12} value={maxPagesPerSite} onChange={(e) => setMaxPagesPerSite(Number(e.target.value || "4"))} />
                </label>
              </div>

              <label>
                Use AI mapping
                <select value={String(useAiMapping)} onChange={(e) => setUseAiMapping(e.target.value === "true")}>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </label>

              <div className="actions">
                <button className="primary" type="submit" disabled={scrapeLoading}>{scrapeLoading ? "Scraping..." : "Run Scraper"}</button>
                {scrapeData?.csv ? (
                  <button className="ghost" type="button" onClick={() => downloadCsv(scrapeData.csv, "scraped_roles.csv")}>Download CSV</button>
                ) : null}
              </div>

              {scrapeData?.summary ? (
                <p className="meta">
                  Companies: {scrapeData.summary.companiesProcessed} | Roles: {scrapeData.count} | India: {scrapeData.summary.indiaRoles} | Abroad: {scrapeData.summary.abroadRoles} | Emails: {scrapeData.summary.emailHits} | {Math.round(scrapeData.summary.durationMs / 1000)}s
                </p>
              ) : null}
              {scrapeError ? <div className="error">{scrapeError}</div> : null}
            </form>
          )}
        </section>

        {tab === "emails" && emailData?.rows?.length ? (
          <section className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Company</th>
                    <th>Email</th>
                    <th>Subject</th>
                    <th>Preview</th>
                  </tr>
                </thead>
                <tbody>
                  {emailData.rows.map((row) => (
                    <tr key={`${row.rowNumber}-${row.personName}`}>
                      <td>{row.personName || "-"}</td>
                      <td>{row.companyName || "-"}</td>
                      <td>{row.detectedEmail || "-"}</td>
                      <td>{row.subject || "-"}</td>
                      <td>{row.emailBody?.slice(0, 170) || "-"}{row.emailBody?.length > 170 ? "..." : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {tab === "scraper" && scrapeData?.rows?.length ? (
          <section className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Job Title</th>
                    <th>India/Abroad</th>
                    <th>Consultant Email</th>
                    <th>AI Matched Role</th>
                  </tr>
                </thead>
                <tbody>
                  {scrapeData.rows.map((row, index) => (
                    <tr key={`${row.website}-${index}`}>
                      <td>{row.companyName || row.website}</td>
                      <td>{row.jobTitle || "-"}</td>
                      <td>{row.roleLocationBucket}</td>
                      <td>{row.consultantEmail || "-"}</td>
                      <td>{row.aiMatchedTargetRole || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
