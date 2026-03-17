import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const STATE_DIR = path.join(process.cwd(), ".cache");
const STATE_FILE = path.join(STATE_DIR, "scrape-state.json");

interface ScrapeState {
  seenFingerprints: Record<string, string>;
}

async function readState(): Promise<ScrapeState> {
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<ScrapeState>;
    return {
      seenFingerprints: parsed.seenFingerprints && typeof parsed.seenFingerprints === "object" ? parsed.seenFingerprints : {}
    };
  } catch {
    return { seenFingerprints: {} };
  }
}

async function writeState(state: ScrapeState): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

export async function splitNewRoleFingerprints(fingerprints: string[]): Promise<{ newFingerprints: Set<string>; skippedCount: number }> {
  const state = await readState();
  const newFingerprints = new Set<string>();
  const seenThisRun = new Set<string>();
  let skippedCount = 0;

  for (const fingerprint of fingerprints) {
    if (state.seenFingerprints[fingerprint] || seenThisRun.has(fingerprint)) {
      skippedCount += 1;
      continue;
    }
    seenThisRun.add(fingerprint);
    newFingerprints.add(fingerprint);
  }

  return { newFingerprints, skippedCount };
}

export async function rememberRoleFingerprints(fingerprints: string[]): Promise<void> {
  if (fingerprints.length === 0) return;

  const state = await readState();
  const timestamp = new Date().toISOString();

  for (const fingerprint of fingerprints) {
    state.seenFingerprints[fingerprint] = timestamp;
  }

  await writeState(state);
}
