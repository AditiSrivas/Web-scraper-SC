import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

export interface ParsedRow {
  rowNumber: number;
  raw: Record<string, unknown>;
}

export interface ParsedTable {
  fileKey: string;
  sheetName: string;
  rows: ParsedRow[];
}

export function normalizeHeader(value: string): string {
  return String(value ?? "")
    .replace(/\r\n/g, " ")
    .replace(/\n/g, " ")
    .replace(/\r/g, " ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function lookupField(record: Record<string, unknown>, aliases: string[]): unknown {
  const normalizedAliases = aliases.map(normalizeHeader);

  for (const [key, value] of Object.entries(record)) {
    if (normalizedAliases.includes(normalizeHeader(key))) {
      return value;
    }
  }

  return "";
}

export async function parseSpreadsheetFile(file: File): Promise<ParsedTable> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(bytes, { type: "buffer" });

  if (!workbook.SheetNames.length) {
    throw new Error("Workbook has no sheets.");
  }

  const preferred =
    workbook.SheetNames.find((name) => normalizeHeader(name) === "linkedin") ??
    workbook.SheetNames.find((name) => normalizeHeader(name) === "sheet1") ??
    workbook.SheetNames[0];

  const sheet = workbook.Sheets[preferred];
  if (!sheet) {
    throw new Error("No worksheet found in workbook.");
  }

  const jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const rows = jsonRows
    .filter(isRecord)
    .map((raw, idx) => ({ raw, rowNumber: idx + 2 }));

  return {
    fileKey: createHash("sha1").update(bytes).digest("hex"),
    sheetName: preferred,
    rows
  };
}
