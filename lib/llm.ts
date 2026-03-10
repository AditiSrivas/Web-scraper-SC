import { EmailResult, LLMProvider, LlmRunOptions, Prospect } from "@/lib/types";
import { buildPrompt } from "@/lib/prospect";

interface LlmConfig {
  provider: LLMProvider;
  modelOverride?: string;
  temperature: number;
  maxTokens: number;
  retries: number;
  fastMode: boolean;
}

interface JobMappingResult {
  matchedRole: string;
  reason: string;
}

function parseJsonPayload<T>(text: string): T {
  const trimmed = text.trim();
  const clean = trimmed.startsWith("```") ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "") : trimmed;

  try {
    return JSON.parse(clean) as T;
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("LLM did not return JSON payload");
    }
    return JSON.parse(match[0]) as T;
  }
}

function getConfig(overrides?: LlmRunOptions): LlmConfig {
  const provider = (overrides?.provider ?? process.env.LLM_PROVIDER ?? "google").toLowerCase() as LLMProvider;
  return {
    provider,
    modelOverride: overrides?.modelOverride,
    temperature: overrides?.temperature ?? Number(process.env.LLM_TEMPERATURE ?? "0.25"),
    maxTokens: overrides?.maxTokens ?? Number(process.env.MAX_TOKENS ?? "300"),
    retries: overrides?.retries ?? Number(process.env.LLM_MAX_RETRIES ?? "2"),
    fastMode: overrides?.fastMode ?? false
  };
}

async function callOpenAI(system: string, user: string, cfg: LlmConfig): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = cfg.modelOverride || process.env.OPENAI_MODEL || "gpt-4o-mini";
  if (!apiKey) throw new Error("OPENAI_API_KEY missing");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: cfg.temperature,
      max_tokens: cfg.maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI error ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "{}";
}

async function callAnthropic(system: string, user: string, cfg: LlmConfig): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = cfg.modelOverride || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929";
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: cfg.maxTokens,
      temperature: cfg.temperature,
      system: `${system} Return only JSON.`,
      messages: [{ role: "user", content: user }]
    })
  });

  if (!response.ok) {
    throw new Error(`Anthropic error ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
  return data.content?.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n") ?? "{}";
}

async function callGoogle(system: string, user: string, cfg: LlmConfig): Promise<string> {
  const apiKey = process.env.GOOGLE_API_KEY;
  const model = cfg.modelOverride || process.env.GOOGLE_MODEL || "gemini-3-pro-preview";
  if (!apiKey) throw new Error("GOOGLE_API_KEY missing");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      generationConfig: {
        temperature: cfg.temperature,
        maxOutputTokens: cfg.maxTokens,
        responseMimeType: "application/json"
      },
      contents: [
        {
          role: "user",
          parts: [{ text: `${system}\n\n${user}\n\nReturn strict JSON only.` }]
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Google error ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "{}";
}

function fallbackEmail(prospect: Prospect, tone: string): EmailResult {
  const firstName = prospect.personName?.split(" ")?.[0] || "there";
  const company = prospect.companyName || "your team";
  return {
    subject: `Support for ${company} active SAP roles`,
    body: `Hi ${firstName},\n\nI noticed your recent hiring activity and wanted to reach out. We support active SAP hiring with deployment-ready consultants aligned to role requirements and timelines.\n\nFor teams managing multiple open positions, we focus on shortlisting quality, practical fit, and low-friction coordination with your hiring process. We can share concise candidate summaries mapped to your posted role context.\n\nIf this hiring need is still active, let me know and I can send a short set of relevant profiles for review.`,
    toneNotes: `fallback | ${tone}`
  };
}

function fallbackMapping(jobTitle: string, roleKeywords: string[]): JobMappingResult {
  const normalized = jobTitle.toLowerCase();
  const matched = roleKeywords.find((r) => normalized.includes(r.toLowerCase()));
  if (matched) {
    return { matchedRole: matched, reason: "Keyword match in job title" };
  }
  return { matchedRole: "", reason: "No close match found" };
}

async function callProvider(system: string, user: string, cfg: LlmConfig): Promise<string> {
  if (cfg.provider === "openai") return callOpenAI(system, user, cfg);
  if (cfg.provider === "anthropic") return callAnthropic(system, user, cfg);
  return callGoogle(system, user, cfg);
}

export async function generateEmailFromProspect(prospect: Prospect, options?: LlmRunOptions): Promise<EmailResult> {
  const cfg = getConfig(options);
  const { system, user, toneContext } = buildPrompt(prospect, cfg.fastMode);

  let lastError: unknown;
  for (let attempt = 1; attempt <= cfg.retries; attempt += 1) {
    try {
      const raw = await callProvider(system, user, cfg);
      const parsed = parseJsonPayload<Partial<EmailResult>>(raw);
      if (!parsed.subject || !parsed.body) {
        throw new Error("Incomplete JSON fields from LLM");
      }
      return {
        subject: String(parsed.subject ?? "").trim(),
        body: String(parsed.body ?? "").trim(),
        toneNotes: String(parsed.toneNotes ?? "").trim()
      };
    } catch (err) {
      lastError = err;
      if (attempt < cfg.retries) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }

  console.error("Email generation failed, using fallback:", lastError);
  return fallbackEmail(prospect, toneContext);
}

export async function aiMapRoleToTarget(
  jobTitle: string,
  pageSnippet: string,
  roleKeywords: string[],
  options?: LlmRunOptions
): Promise<JobMappingResult> {
  if (roleKeywords.length === 0) {
    return { matchedRole: "", reason: "No target roles provided" };
  }

  const cfg = getConfig({ ...options, maxTokens: Math.min(options?.maxTokens ?? 150, 180), fastMode: true });
  const system = "Classify job relevance against target roles. Return strict JSON: matchedRole, reason.";
  const user = [
    `Job Title: ${jobTitle}`,
    `Page Snippet: ${pageSnippet.slice(0, 700)}`,
    `Target Roles: ${roleKeywords.join(", ")}`,
    "Pick one closest matchedRole from Target Roles, or empty string if none.",
    "Reason must be under 20 words."
  ].join("\n");

  try {
    const raw = await callProvider(system, user, cfg);
    const parsed = parseJsonPayload<Partial<JobMappingResult>>(raw);
    return {
      matchedRole: String(parsed.matchedRole ?? "").trim(),
      reason: String(parsed.reason ?? "").trim() || "AI mapped"
    };
  } catch {
    return fallbackMapping(jobTitle, roleKeywords);
  }
}
