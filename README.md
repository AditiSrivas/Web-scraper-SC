# Outreach Engine (Next.js + Vercel)

Two use cases in one app:

1. Personalized email generation from `LinkedIn Active Roles.xlsx`.
2. Website scraper that finds job-like roles, classifies India vs abroad, extracts consultant emails, and AI-maps to your target role list.

## Key speed upgrades

- Parallel email generation (`concurrency` control).
- Fast mode prompt (`90-130` words, lower token usage).
- Runtime provider/model switching from UI.
- Per-run perf metrics (`totalMs`, `rowsPerMinute`, avg row latency).

For your target (5-6 rows < 1 min), start with:
- `concurrency=4`
- `fastMode=true`
- `maxTokens=180-240`
- fast model (example: `gpt-4o-mini` or `gemini flash` model in your account)

## Setup

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Environment variables

- `LLM_PROVIDER=google|openai|anthropic`
- `LLM_TEMPERATURE=0.2`
- `MAX_TOKENS=300`
- `LLM_MAX_RETRIES=2`
- `OPENAI_API_KEY=`
- `OPENAI_MODEL=gpt-4o-mini`
- `ANTHROPIC_API_KEY=`
- `ANTHROPIC_MODEL=claude-sonnet-4-5-20250929`
- `GOOGLE_API_KEY=`
- `GOOGLE_MODEL=gemini-3-pro-preview`

## API routes

- `POST /api/generate` (email generation)
- `POST /api/scrape-jobs` (website scraper + mapping)

## Input expectations

- Email generator input: your LinkedIn `.xlsx` (same format you provided).
- Scraper input: CSV/XLSX with at least a `Website` column (and optional `Company Name`).

## Vercel deploy

1. Push repo to GitHub.
2. Import project in Vercel.
3. Add env vars in Vercel settings.
4. Deploy.
