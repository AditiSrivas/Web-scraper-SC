#!/usr/bin/env python3
import argparse
import csv
import json
import os
import re
import time
import zipfile
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from urllib import error, parse, request
import xml.etree.ElementTree as ET

WORKBOOK_NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main", "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
RELS_NS = "{http://schemas.openxmlformats.org/package/2006/relationships}"


@dataclass
class Prospect:
    person_name: str
    person_details: str
    country: str
    linkedin_id: str
    company_name: str
    company_details: str
    employee_count_raw: str
    employee_distribution: str
    activities_details: str
    contact_details: str

    @property
    def employee_count(self) -> Optional[int]:
        digits = re.sub(r"[^0-9]", "", self.employee_count_raw or "")
        if not digits:
            return None
        try:
            return int(digits)
        except ValueError:
            return None


@dataclass
class EmailResult:
    subject: str
    body: str
    tone_notes: str


def load_env(path: str = ".env") -> None:
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            v = v.strip()
            if k and k not in os.environ:
                os.environ[k] = v


def read_shared_strings(z: zipfile.ZipFile) -> List[str]:
    if "xl/sharedStrings.xml" not in z.namelist():
        return []
    sst = ET.fromstring(z.read("xl/sharedStrings.xml"))
    out = []
    for si in sst.findall("a:si", WORKBOOK_NS):
        out.append("".join(t.text or "" for t in si.findall(".//a:t", WORKBOOK_NS)))
    return out


def get_sheet_xml_path(z: zipfile.ZipFile, preferred_sheet: Optional[str] = None) -> str:
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    rel_map = {r.attrib["Id"]: r.attrib["Target"] for r in rels.findall(f"{RELS_NS}Relationship")}

    sheets = wb.findall("a:sheets/a:sheet", WORKBOOK_NS)
    chosen = None
    if preferred_sheet:
        preferred_lower = preferred_sheet.strip().lower()
        for s in sheets:
            if s.attrib.get("name", "").strip().lower() == preferred_lower:
                chosen = s
                break

    if chosen is None:
        # Default to first non-empty sheet name.
        for s in sheets:
            name = s.attrib.get("name", "").strip()
            if name:
                chosen = s
                break

    if chosen is None:
        raise ValueError("No worksheets found in workbook")

    rid = chosen.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
    target = rel_map[rid]
    return f"xl/{target}"


def cell_value(cell: ET.Element, shared_strings: List[str]) -> str:
    t = cell.attrib.get("t")
    v = cell.find("a:v", WORKBOOK_NS)
    if v is None or v.text is None:
        return ""
    raw = v.text
    if t == "s":
        idx = int(raw)
        return shared_strings[idx] if 0 <= idx < len(shared_strings) else ""
    return raw


def normalize_header(text: str) -> str:
    text = (text or "").strip().lower()
    text = re.sub(r"\s+", " ", text)
    text = text.replace("\n", " ")
    return text


def parse_xlsx_roles(path: str, sheet_name: Optional[str]) -> List[Prospect]:
    with zipfile.ZipFile(path) as z:
        shared = read_shared_strings(z)
        ws = ET.fromstring(z.read(get_sheet_xml_path(z, sheet_name)))

    rows = ws.findall("a:sheetData/a:row", WORKBOOK_NS)
    if not rows:
        return []

    header_row = rows[0]
    col_to_header: Dict[str, str] = {}

    for c in header_row.findall("a:c", WORKBOOK_NS):
        ref = c.attrib.get("r", "")
        col = re.sub(r"[^A-Z]", "", ref)
        h = cell_value(c, shared).replace("\n", " ").strip()
        if not h or h == "L":
            continue
        col_to_header[col] = h

    normalized_map = {
        "person name or company name": "person_name",
        "person details": "person_details",
        "country": "country",
        "linkedin id": "linkedin_id",
        "current company name": "company_name",
        "current company details": "company_details",
        "no. of employees in current company": "employee_count_raw",
        "countrywise distribution of employees in current company": "employee_distribution",
        "activities details": "activities_details",
        "person contact details": "contact_details",
    }

    out: List[Prospect] = []
    for row in rows[1:]:
        data = {v: "" for v in normalized_map.values()}
        for c in row.findall("a:c", WORKBOOK_NS):
            ref = c.attrib.get("r", "")
            col = re.sub(r"[^A-Z]", "", ref)
            if col not in col_to_header:
                continue
            header = normalize_header(col_to_header[col])
            header = re.sub(r"\s+", " ", header).strip()
            key = normalized_map.get(header)
            if not key:
                continue
            data[key] = cell_value(c, shared).strip()

        if not any(data.values()):
            continue

        out.append(Prospect(**data))

    return out


def infer_industry(company_details: str) -> str:
    text = (company_details or "").lower()
    if "staffing" in text or "recruit" in text:
        return "Staffing"
    if "consulting" in text or "it services" in text or "software" in text:
        return "IT Services / Consulting"
    return "Unknown"


def infer_country_bucket(country: str) -> str:
    c = (country or "").lower()
    return "India" if "india" in c else "Overseas"


def infer_title_bucket(person_details: str) -> str:
    t = (person_details or "").lower()
    if any(x in t for x in ["ceo", "vp", "director", "head "]):
        return "Leadership"
    if any(x in t for x in ["manager", "lead"]):
        return "Manager"
    if any(x in t for x in ["recruit", "talent", "hr", "human resource"]):
        return "Recruiter/HR"
    return "General"


def employee_bucket(employee_count: Optional[int]) -> str:
    if employee_count is None:
        return "Unknown"
    if employee_count <= 10:
        return "1-10"
    if employee_count <= 50:
        return "11-50"
    if employee_count <= 200:
        return "50-200"
    if employee_count <= 1000:
        return "200-1000"
    if employee_count <= 10000:
        return "1000-10000"
    return "10000+"


def extract_email(contact_details: str) -> str:
    match = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", contact_details or "")
    return match.group(0) if match else ""


def build_prompt(p: Prospect) -> Tuple[str, str]:
    country_bucket = infer_country_bucket(p.country)
    industry = infer_industry(p.company_details)
    title_bucket = infer_title_bucket(p.person_details)
    size_bucket = employee_bucket(p.employee_count)

    system = (
        "You write concise B2B outreach emails for SAP hiring-related partnership outreach. "
        "Output JSON only with keys: subject, body, tone_notes. "
        "Email body must be 120-170 words, clear and human, no spammy claims, no fake personalization. "
        "Use this logic: country influences deployment framing, industry influences value angle, "
        "size influences maturity tone, title influences CTA style."
    )

    user = f"""
Generate one personalized cold email using the context below.

Prospect context:
- Person Name: {p.person_name}
- Person Details: {p.person_details}
- Country/Location: {p.country}
- LinkedIn: {p.linkedin_id}
- Company Name: {p.company_name}
- Company Details: {p.company_details}
- Employee Count: {p.employee_count_raw}
- Employee Distribution: {p.employee_distribution}
- Activity/Role Post: {p.activities_details}

Derived dimensions:
- Country Bucket: {country_bucket}
- Industry Bucket: {industry}
- Title Bucket: {title_bucket}
- Employee Size Bucket: {size_bucket}

Rules:
1) Keep structure in 3 blocks: deployment statement, value emphasis, CTA.
2) If India -> emphasize quick deployment + local alignment.
3) If Overseas -> emphasize global delivery readiness + governance.
4) Staffing/Recruiting -> emphasize submission-ready quality and speed.
5) IT consulting/services -> emphasize delivery ownership, integration stability.
6) Small firms -> urgent and lean tone. Enterprise -> governance and risk mitigation tone.
7) Recruiter/HR CTA style: "let me know if I can share profiles" style.
8) Leadership CTA style: "please advise how to proceed" style.
9) Keep safe and factual. No unverifiable numbers.

Return strict JSON only.
""".strip()

    return system, user


def http_post_json(url: str, payload: Dict, headers: Dict[str, str], timeout: int = 60) -> Dict:
    data = json.dumps(payload).encode("utf-8")
    req = request.Request(url, data=data, headers=headers, method="POST")
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body)
    except error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code} from {url}: {body[:800]}")


def call_openai(system: str, user: str) -> str:
    key = os.getenv("OPENAI_API_KEY", "")
    if not key:
        raise RuntimeError("OPENAI_API_KEY is missing")
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    url = "https://api.openai.com/v1/chat/completions"
    payload = {
        "model": model,
        "temperature": float(os.getenv("LLM_TEMPERATURE", "0.4") or "0.4"),
        "max_tokens": int(os.getenv("MAX_TOKENS", "400") or "400"),
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    data = http_post_json(url, payload, {"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    return data["choices"][0]["message"]["content"]


def call_anthropic(system: str, user: str) -> str:
    key = os.getenv("ANTHROPIC_API_KEY", "")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY is missing")
    model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5-20250929")
    url = "https://api.anthropic.com/v1/messages"
    payload = {
        "model": model,
        "max_tokens": int(os.getenv("MAX_TOKENS", "400") or "400"),
        "temperature": float(os.getenv("LLM_TEMPERATURE", "0.4") or "0.4"),
        "system": system + " Return only JSON.",
        "messages": [{"role": "user", "content": user}],
    }
    data = http_post_json(
        url,
        payload,
        {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
    )
    content = data.get("content", [])
    text_parts = [c.get("text", "") for c in content if c.get("type") == "text"]
    return "\n".join(text_parts).strip()


def call_google(system: str, user: str) -> str:
    key = os.getenv("GOOGLE_API_KEY", "")
    if not key:
        raise RuntimeError("GOOGLE_API_KEY is missing")
    model = os.getenv("GOOGLE_MODEL", "gemini-3-pro-preview")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{parse.quote(model, safe='')}:generateContent?key={parse.quote(key, safe='')}"
    prompt = f"{system}\n\n{user}\n\nReturn JSON only."
    payload = {
        "generationConfig": {
            "temperature": float(os.getenv("LLM_TEMPERATURE", "0.4") or "0.4"),
            "maxOutputTokens": int(os.getenv("MAX_TOKENS", "400") or "400"),
            "responseMimeType": "application/json",
        },
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
    }
    data = http_post_json(url, payload, {"Content-Type": "application/json"})
    cands = data.get("candidates", [])
    if not cands:
        raise RuntimeError(f"Google response missing candidates: {data}")
    parts = cands[0].get("content", {}).get("parts", [])
    txt = "".join(p.get("text", "") for p in parts)
    return txt


def parse_json_response(text: str) -> EmailResult:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text).strip()
        text = re.sub(r"```$", "", text).strip()

    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            raise
        obj = json.loads(match.group(0))

    return EmailResult(
        subject=str(obj.get("subject", "")).strip(),
        body=str(obj.get("body", "")).strip(),
        tone_notes=str(obj.get("tone_notes", "")).strip(),
    )


def fallback_email(p: Prospect) -> EmailResult:
    country = infer_country_bucket(p.country)
    industry = infer_industry(p.company_details)
    title = infer_title_bucket(p.person_details)
    cta = "Please advise if we can share a few aligned profiles." if title == "Leadership" else "Let me know if I can share relevant profiles."
    subject = f"Support for {p.company_name or 'your active roles'}"
    body = (
        f"Hi {p.person_name or 'there'},\n\n"
        f"I came across your recent hiring activity and thought to reach out. We support SAP hiring with consultants who are deployment-ready and matched to active role needs. "
        f"For {country.lower()}-focused hiring, we can move quickly with local alignment; for distributed teams, we support structured remote delivery.\n\n"
        f"Given your context in {industry}, our focus is on quality fit, faster shortlisting, and low-friction collaboration with hiring teams. "
        f"We can share concise candidate snapshots tailored to the requirement details you posted.\n\n"
        f"{cta}\n"
    )
    notes = f"fallback template | country={country}, industry={industry}, title={title}"
    return EmailResult(subject=subject, body=body, tone_notes=notes)


def call_llm(system: str, user: str, provider: str, retries: int) -> EmailResult:
    func_map = {
        "openai": call_openai,
        "anthropic": call_anthropic,
        "google": call_google,
    }
    fn = func_map.get(provider.lower())
    if not fn:
        raise ValueError(f"Unsupported LLM_PROVIDER={provider}. Use one of: openai, anthropic, google")

    last_err: Optional[Exception] = None
    for attempt in range(1, retries + 1):
        try:
            raw = fn(system, user)
            return parse_json_response(raw)
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(1.5 * attempt)

    raise RuntimeError(f"Failed after {retries} attempts: {last_err}")


def generate_emails(prospects: List[Prospect], provider: str, retries: int, dry_run: bool) -> List[Dict[str, str]]:
    rows = []
    for idx, p in enumerate(prospects, start=1):
        system, user = build_prompt(p)
        email = fallback_email(p) if dry_run else call_llm(system, user, provider=provider, retries=retries)
        rows.append(
            {
                "row_number": str(idx + 1),
                "person_name": p.person_name,
                "company_name": p.company_name,
                "country": p.country,
                "detected_email": extract_email(p.contact_details),
                "linkedin_id": p.linkedin_id,
                "subject": email.subject,
                "email_body": email.body,
                "tone_notes": email.tone_notes,
            }
        )
    return rows


def write_csv(path: str, rows: List[Dict[str, str]]) -> None:
    if not rows:
        with open(path, "w", newline="", encoding="utf-8") as f:
            f.write("")
        return

    headers = list(rows[0].keys())
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


def build_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate personalized outreach emails from LinkedIn active roles XLSX")
    parser.add_argument("--input", default="Linkedin 020326 - Active Roles.xlsx", help="Path to source XLSX")
    parser.add_argument("--sheet", default="Linkedin ", help="Sheet name (default matches provided workbook)")
    parser.add_argument("--output", default="generated_emails.csv", help="Path to output CSV")
    parser.add_argument("--limit", type=int, default=0, help="Process only first N rows (0 = all)")
    parser.add_argument("--dry-run", action="store_true", help="Generate rule-based emails without calling an LLM API")
    return parser.parse_args()


def main() -> None:
    args = build_args()
    load_env()

    provider = os.getenv("LLM_PROVIDER", "google").strip().lower()
    retries = int(os.getenv("LLM_MAX_RETRIES", "3") or "3")

    prospects = parse_xlsx_roles(args.input, args.sheet)
    if args.limit and args.limit > 0:
        prospects = prospects[: args.limit]

    if not prospects:
        raise SystemExit("No prospect rows found in workbook")

    rows = generate_emails(prospects, provider=provider, retries=retries, dry_run=args.dry_run)
    write_csv(args.output, rows)

    print(f"Generated {len(rows)} email records -> {args.output}")
    print(f"Provider: {provider} | dry_run={args.dry_run}")


if __name__ == "__main__":
    main()
