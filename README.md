# Outreach Engine

Outreach Engine is a lead generation and outreach workflow project built around three parts:

- A `frontend` Next.js app for uploading files, running AI-powered email generation, and triggering website scraping.
- An `email-automator` Python utility for generating personalized outreach emails from LinkedIn-style Excel exports.
- A `web-scraper` area for scraper input files such as company website lists.

## Project Structure

```text
.
|-- frontend/
|   |-- app/
|   |-- lib/
|   |-- package.json
|   |-- tsconfig.json
|   `-- .env.local.example
|-- email-automator/
|   |-- email_generator.py
|   |-- Linkedin 020326 - Active Roles.xlsx
|   `-- Active roles customization rules.docx
|-- web-scraper/
|   `-- U.K-companies.csv
`-- README.md
```

## What The Project Does

- Generates personalized cold emails from uploaded CSV/XLSX prospect files.
- Scrapes company websites for role openings and job-related contact details.
- Uses LLMs to map scraped roles to target roles and draft outreach emails.
- Supports OpenAI, Anthropic, and Google model providers from the frontend UI.

## Tech Used

- `Next.js 14`
- `React 18`
- `TypeScript`
- `Node.js`
- `Python 3`
- `xlsx` for spreadsheet parsing
- LLM integrations for OpenAI, Anthropic, and Google

## Installation

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd Web-scraper-SC
```

### 2. Set up the frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local
```

Add your API keys to `frontend/.env.local`.

Supported environment variables:

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

### 3. Run the frontend

```bash
cd frontend
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

### 4. Run the Python email automator

The Python tool lives in `email-automator/` and uses only Python standard library modules.

```bash
cd email-automator
python3 email_generator.py --help
```

## Usage Notes

- Upload prospect/activity CSV or XLSX files in the frontend to generate emails.
- Upload company website lists in the frontend scraper tab to discover job openings and draft outreach.
- Scraper state is stored in `frontend/.cache/scrape-state.json`.
- Sample input files are included in `email-automator/` and `web-scraper/`.

## Development

Frontend commands:

```bash
cd frontend
npm run dev
npm run build
npm run lint
```

## Suggested Next Cleanup

- Add a root `.gitignore` if you want to stop tracking build output like `.next/` and installed packages.
- Add dedicated READMEs inside `frontend/`, `email-automator/`, and `web-scraper/` if you want each module documented separately.
