/**
 * HYDRO AI — personal vocabulary and custom gesture templates.
 *
 * Both are user-authored, inspectable and deletable. Nothing here is inferred:
 * an alias exists because the user typed it, and a gesture template exists
 * because the user captured that exact hand pose.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { logAudit } from "./ai-home";
import { applyPhraseAliases } from "./planner";

export interface Alias {
  id: string;
  alias: string;
  canonical: string;
  createdAt: string;
}

export interface GestureTemplate {
  id: string;
  name: string;
  command: string;
  /** 42 normalised landmark coordinates: 21 points × (x, y) */
  signature: number[];
  createdAt: string;
}

const ALIAS_FILE = join(process.cwd(), ".data", "vocabulary.json");
const GESTURE_FILE = join(process.cwd(), ".data", "gestures.json");

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

async function readArray<T>(file: string): Promise<T[]> {
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as T[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeArray<T>(file: string, items: T[]): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(items.slice(0, 200), null, 2), "utf8");
  await rename(tmp, file);
}

// ── vocabulary ─────────────────────────────────────────────────────────────

export async function readAliases(): Promise<Alias[]> {
  return readArray<Alias>(ALIAS_FILE);
}

export async function addAlias(alias: string, canonical: string): Promise<Alias> {
  const cleanAlias = alias.trim().slice(0, 80);
  const cleanCanonical = canonical.trim().slice(0, 200);
  if (cleanAlias.length < 2 || cleanCanonical.length < 2) {
    throw new Error("Both the phrase and its meaning are required.");
  }
  const record: Alias = {
    id: uid("alias"),
    alias: cleanAlias,
    canonical: cleanCanonical,
    createdAt: new Date().toISOString(),
  };
  const current = await readAliases();
  const next = [record, ...current.filter((a) => a.alias.toLowerCase() !== cleanAlias.toLowerCase())];
  await writeArray(ALIAS_FILE, next);
  await logAudit("vocabulary.alias_added", `"${cleanAlias}" → "${cleanCanonical.slice(0, 80)}"`);
  return record;
}

export async function deleteAlias(id: string): Promise<boolean> {
  const current = await readAliases();
  const next = current.filter((a) => a.id !== id);
  if (next.length === current.length) return false;
  await writeArray(ALIAS_FILE, next);
  await logAudit("vocabulary.alias_deleted", id);
  return true;
}

/** Kept as the module's public name; the implementation is the shared pure helper. */
export function applyAliases(text: string, aliases: Alias[]): string {
  return applyPhraseAliases(text, aliases);
}

// ── custom gestures ────────────────────────────────────────────────────────

export async function readGestureTemplates(): Promise<GestureTemplate[]> {
  return readArray<GestureTemplate>(GESTURE_FILE);
}

export async function addGestureTemplate(input: {
  name: string;
  command: string;
  signature: unknown;
}): Promise<GestureTemplate> {
  const name = String(input.name ?? "").trim().slice(0, 60);
  const command = String(input.command ?? "").trim().slice(0, 200);
  if (name.length < 2 || command.length < 3) {
    throw new Error("A gesture needs a name and a command.");
  }
  const signature = Array.isArray(input.signature)
    ? input.signature.map((n) => Number(n))
    : [];
  if (signature.length !== 42 || signature.some((n) => !Number.isFinite(n) || Math.abs(n) > 10)) {
    throw new Error("Invalid pose signature — capture the gesture again.");
  }
  const record: GestureTemplate = {
    id: uid("pose"),
    name,
    command,
    signature: signature.map((n) => Math.round(n * 1000) / 1000),
    createdAt: new Date().toISOString(),
  };
  const current = await readGestureTemplates();
  await writeArray(GESTURE_FILE, [record, ...current.filter((g) => g.name !== name)]);
  await logAudit("gesture.template_added", `"${name}" → "${command.slice(0, 80)}"`);
  return record;
}

export async function deleteGestureTemplate(id: string): Promise<boolean> {
  const current = await readGestureTemplates();
  const next = current.filter((g) => g.id !== id);
  if (next.length === current.length) return false;
  await writeArray(GESTURE_FILE, next);
  await logAudit("gesture.template_deleted", id);
  return true;
}
