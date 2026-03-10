export type LLMProvider = "google" | "openai" | "anthropic";

export interface Prospect {
  personName: string;
  personDetails: string;
  country: string;
  linkedinId: string;
  companyName: string;
  companyDetails: string;
  employeeCountRaw: string;
  employeeDistribution: string;
  activitiesDetails: string;
  contactDetails: string;
}

export interface EmailResult {
  subject: string;
  body: string;
  toneNotes: string;
}

export interface GeneratedRow {
  rowNumber: number;
  personName: string;
  companyName: string;
  country: string;
  detectedEmail: string;
  linkedinId: string;
  subject: string;
  emailBody: string;
  toneNotes: string;
}

export interface LlmRunOptions {
  provider?: LLMProvider;
  modelOverride?: string;
  temperature?: number;
  maxTokens?: number;
  retries?: number;
  fastMode?: boolean;
}

export interface ScrapedJobRow {
  companyName: string;
  website: string;
  pageUrl: string;
  jobTitle: string;
  roleLocationBucket: "India" | "Abroad" | "Unknown";
  consultantEmail: string;
  aiMatchedTargetRole: string;
  aiMatchReason: string;
}
