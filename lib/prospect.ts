import { Prospect, ScrapedJobRow } from "@/lib/types";

function toStringValue(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

export function normalizeProspect(input: Record<string, unknown>): Prospect {
  return {
    personName: toStringValue(input["Person Name or\nCompany Name"] || input["Person Name or Company Name"]),
    personDetails: toStringValue(input["Person\nDetails"] || input["Person Details"]),
    country: toStringValue(input["Country"]),
    linkedinId: toStringValue(input["Linkedin\nId"] || input["Linkedin Id"]),
    companyName: toStringValue(input["Current Company Name"]),
    companyDetails: toStringValue(input["Current Company\n Details"] || input["Current Company Details"]),
    employeeCountRaw: toStringValue(input["No. of Employees in \nCurrent Company\n"] || input["No. of Employees in Current Company"]),
    employeeDistribution: toStringValue(
      input["Countrywise distribution\nof employees in Current\nCompany"] || input["Countrywise distribution of employees in Current Company"]
    ),
    activitiesDetails: toStringValue(input["Activities\nDetails"] || input["Activities Details"]),
    contactDetails: toStringValue(input["Person contact\nDetails"] || input["Person contact Details"])
  };
}

export function inferIndustry(companyDetails: string): "Staffing" | "IT Services / Consulting" | "Unknown" {
  const value = companyDetails.toLowerCase();
  if (value.includes("staffing") || value.includes("recruit")) return "Staffing";
  if (value.includes("consulting") || value.includes("it services") || value.includes("software")) return "IT Services / Consulting";
  return "Unknown";
}

export function inferCountryBucket(country: string): "India" | "Overseas" {
  return country.toLowerCase().includes("india") ? "India" : "Overseas";
}

export function inferTitleBucket(personDetails: string): "Recruiter/HR" | "Manager" | "Leadership" | "General" {
  const value = personDetails.toLowerCase();
  if (["ceo", "vp", "director", "head"].some((k) => value.includes(k))) return "Leadership";
  if (["manager", "lead"].some((k) => value.includes(k))) return "Manager";
  if (["recruit", "talent", "hr", "human resource"].some((k) => value.includes(k))) return "Recruiter/HR";
  return "General";
}

export function extractEmail(contactDetails: string): string {
  const match = contactDetails.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return match ? match[0] : "";
}

export function employeeCount(raw: string): number | null {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const num = Number(digits);
  return Number.isNaN(num) ? null : num;
}

export function employeeBucket(raw: string): string {
  const count = employeeCount(raw);
  if (count == null) return "Unknown";
  if (count <= 10) return "1-10";
  if (count <= 50) return "11-50";
  if (count <= 200) return "50-200";
  if (count <= 1000) return "200-1000";
  if (count <= 10000) return "1000-10000";
  return "10000+";
}

export function buildPrompt(prospect: Prospect, fastMode = false): { system: string; user: string; toneContext: string } {
  const country = inferCountryBucket(prospect.country);
  const industry = inferIndustry(prospect.companyDetails);
  const title = inferTitleBucket(prospect.personDetails);
  const size = employeeBucket(prospect.employeeCountRaw);

  const system = fastMode
    ? "Write a concise B2B outreach email. Return strict JSON with keys subject, body, toneNotes."
    : "You write concise, high-conversion B2B outreach emails for SAP hiring partnership offers. Return strict JSON with keys subject, body, toneNotes.";

  const user = [
    "Generate one personalized cold email.",
    "Use this structure: 1) deployment statement 2) value emphasis 3) CTA.",
    `Person Name: ${prospect.personName}`,
    `Person Details: ${prospect.personDetails}`,
    `Country/Location: ${prospect.country}`,
    `LinkedIn: ${prospect.linkedinId}`,
    `Company Name: ${prospect.companyName}`,
    `Company Details: ${prospect.companyDetails}`,
    `Employee Count: ${prospect.employeeCountRaw}`,
    `Employee Distribution: ${prospect.employeeDistribution}`,
    `Activity/Role Post: ${prospect.activitiesDetails}`,
    `Derived Country Bucket: ${country}`,
    `Derived Industry Bucket: ${industry}`,
    `Derived Title Bucket: ${title}`,
    `Derived Employee Size Bucket: ${size}`,
    "Rules:",
    "- India: quick deployment + local alignment.",
    "- Overseas: global delivery readiness + governance.",
    "- Staffing: submission-ready profile quality and speed.",
    "- IT Services/Consulting: delivery ownership + integration stability.",
    "- Small firms: urgent, lean tone. Enterprise: governance and risk mitigation.",
    "- Recruiter CTA: let me know if I can share profiles.",
    "- Leadership CTA: please advise how to proceed.",
    fastMode
      ? "Constraints: factual, no fake numbers, body 90-130 words, plain business English."
      : "Constraints: keep it factual, no fake numbers, body 120-170 words, plain business English."
  ].join("\n");

  return { system, user, toneContext: `${country} | ${industry} | ${title} | ${size}` };
}

export function buildProspectFromScrapedRole(role: ScrapedJobRow): Prospect {
  const location = role.roleLocationText || role.roleLocationBucket;
  const target = role.aiMatchedTargetRole || "relevant SAP/ERP hiring";
  const technologies = role.requiredTechnologies || "Not explicitly listed";

  return {
    personName: "",
    personDetails: "Talent Acquisition / Hiring Team",
    country: location,
    linkedinId: role.pageUrl,
    companyName: role.companyName || role.website,
    companyDetails: `Company careers page / website hiring signal sourced from ${role.website}`,
    employeeCountRaw: "",
    employeeDistribution: "",
    activitiesDetails: [
      `Open Role: ${role.jobTitle || "Role not extracted"}`,
      `Matched Target Role: ${target}`,
      `Location: ${location}`,
      `Technologies: ${technologies}`,
      `Job Description: ${role.jobDescription || role.roleSnippet || "No extra snippet available"}`,
      `Role Context: ${role.roleSnippet || "No extra snippet available"}`,
      `Source: ${role.pageUrl}`
    ].join("\n"),
    contactDetails: role.contactInformation || role.consultantEmail
  };
}
