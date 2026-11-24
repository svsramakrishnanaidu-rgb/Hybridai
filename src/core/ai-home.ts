/**
 * HYDRO AI — dedicated, sandboxed AI home on disk.
 *
 * Everything HYDRO is allowed to touch lives under one root directory
 * (`HYDRO_AI_HOME`, default `.data/ai-home`). Paths are resolved and verified on
 * every call, so a crafted instruction cannot escape the root, read a parent
 * directory or follow a symlink out of the sandbox.
 *
 * This module deliberately owns no shell, no process spawning and no access to
 * Windows system folders. Those require a separate privileged agent and are not
 * implemented here.
 *
 * Permission levels:
 *   1 Observe  — read and search
 *   2 Create   — new files and folders
 *   3 Manage   — overwrite, move, rename, move-to-trash
 *   4 Sensitive system operations — refused: no native agent is installed
 */

import {
  appendFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import os from "node:os";

export type Level = 1 | 2 | 3 | 4;

export const LEVEL_NAMES: Record<Level, string> = {
  1: "Observe",
  2: "Create",
  3: "Manage",
  4: "Sensitive system",
};

export const HOME_FOLDERS = [
  "brain",
  "memory",
  "knowledge",
  "learning",
  "tools",
  "skills",
  "projects",
  "workspace",
  "vision",
  "voice",
  "hologram",
  "backups",
  "diagnostics",
  "security",
  "updates",
] as const;

export interface Entry {
  name: string;
  path: string;
  type: "file" | "dir";
  bytes: number;
  modifiedAt: string;
}

export interface Usage {
  root: string;
  files: number;
  bytes: number;
  quotaBytes: number;
  folders: Array<{ name: string; files: number; bytes: number }>;
}

const MAX_READ = 400_000;
const MAX_WRITE = 600_000;
const TEXT_EXT = new Set([
  ".md", ".txt", ".json", ".csv", ".ts", ".tsx", ".js", ".jsx", ".py", ".rb", ".go",
  ".rs", ".java", ".c", ".cpp", ".h", ".css", ".html", ".yml", ".yaml", ".toml",
  ".sql", ".sh", ".log", ".xml", ".svg",
]);
/** Credential-shaped names are never readable or writable through this API. */
const DENIED = /(^|[\\/])(\.env(\..*)?|id_rsa|id_ed25519|.*\.(pem|key|pfx|p12|kdbx))$/i;

export function homeRoot(): string {
  const configured = process.env.HYDRO_AI_HOME?.trim();
  return resolve(configured && isAbsolute(configured) ? configured : join(process.cwd(), ".data", "ai-home"));
}

export function quotaBytes(): number {
  const mb = Number(process.env.HYDRO_HOME_QUOTA_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 512) * 1024 * 1024;
}

// ── permission level ───────────────────────────────────────────────────────

function permFile(): string {
  return process.env.HYDRO_PERM_FILE?.trim() || join(process.cwd(), ".data", "execution-permissions.json");
}

export async function getLevel(): Promise<Level> {
  try {
    const raw = JSON.parse(await readFile(permFile(), "utf8")) as { level?: number };
    const level = Number(raw.level);
    return level === 1 || level === 2 || level === 3 || level === 4 ? (level as Level) : 2;
  } catch {
    return 2;
  }
}

export async function setLevel(level: Level): Promise<Level> {
  const safe: Level = level === 1 || level === 2 || level === 3 ? level : 2;
  const file = permFile();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ level: safe, updatedAt: new Date().toISOString() }, null, 2));
  await logAudit("permissions.level", `set to ${safe} (${LEVEL_NAMES[safe]})`);
  return safe;
}

/** Pure gate used by the executor and asserted in the self-test. */
export function levelAllows(level: Level, tool: string): boolean {
  return level >= requiredLevelFor(tool);
}

export function requiredLevelFor(tool: string): Level {
  switch (tool) {
    case "home.write":
    case "home.mkdir":
      return 2;
    case "home.move":
    case "home.trash":
      return 3;
    default:
      return 1;
  }
}

// ── audit ──────────────────────────────────────────────────────────────────

export async function logAudit(action: string, detail: string): Promise<void> {
  try {
    const dir = join(homeRoot(), "diagnostics");
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, "audit.log"), `${JSON.stringify({ at: new Date().toISOString(), action, detail })}\n`);
  } catch {
    // auditing must never break the operation it describes
  }
}

export async function readAudit(limit = 40): Promise<Array<{ at: string; action: string; detail: string }>> {
  try {
    const raw = await readFile(join(homeRoot(), "diagnostics", "audit.log"), "utf8");
    // keep the tail: this is a log, not a database
    const lines = raw.trim().split("\n").slice(-limit);
    return lines
      .map((line) => {
        try {
          return JSON.parse(line) as { at: string; action: string; detail: string };
        } catch {
          return null;
        }
      })
      .filter((v): v is { at: string; action: string; detail: string } => v !== null)
      .reverse();
  } catch {
    return [];
  }
}

// ── sandbox ────────────────────────────────────────────────────────────────

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export class SandboxError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Resolve a user-supplied relative path and prove it stays inside the home. */
export async function safePath(rel = ""): Promise<string> {
  if (typeof rel !== "string" || rel.includes("\0")) {
    throw new SandboxError("Invalid path");
  }
  const root = homeRoot();
  await mkdir(root, { recursive: true });
  if (/^[a-zA-Z]:/.test(rel) || isAbsolute(rel)) {
    throw new SandboxError("Absolute paths are not allowed", 403);
  }
  const cleaned = rel.replace(/^[\\/]+/, "");
  if (isAbsolute(cleaned)) throw new SandboxError("Absolute paths are not allowed", 403);
  if (DENIED.test(cleaned)) throw new SandboxError("Credential-shaped files are off limits", 403);

  const target = resolve(root, cleaned);
  if (!inside(root, target)) throw new SandboxError("Path escapes the AI home", 403);

  // resolve symlinks on the deepest existing ancestor
  let probe = target;
  for (let i = 0; i < 40; i++) {
    try {
      const real = await realpath(probe);
      const realRoot = await realpath(root);
      if (!inside(realRoot, real)) throw new SandboxError("Symlink escapes the AI home", 403);
      break;
    } catch (err) {
      if (err instanceof SandboxError) throw err;
      const parent = dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
  }
  return target;
}

/** Path relative to the home root, for display and for API round-trips. */
export async function relativePath(abs: string): Promise<string> {
  return relative(homeRoot(), abs).split(sep).join("/");
}

// ── lifecycle ──────────────────────────────────────────────────────────────

export async function ensureHome(): Promise<string> {
  const root = homeRoot();
  await mkdir(root, { recursive: true });
  for (const folder of HOME_FOLDERS) await mkdir(join(root, folder), { recursive: true });
  const readme = join(root, "README.md");
  try {
    await stat(readme);
  } catch {
    await writeFile(
      readme,
      [
        "# HYDRO AI home",
        "",
        "This folder is the assistant's dedicated workspace. Every path the assistant can",
        "read or write is checked to stay inside this directory.",
        "",
        "Folders are created on first launch:",
        ...HOME_FOLDERS.map((f) => `- ${f}/`),
        "",
        "`diagnostics/audit.log` records every operation, including denials.",
        "`security/` is writable only at permission level 3 and never contains credentials.",
        "Move files out of `.trash/` to restore them.",
        "",
      ].join("\n"),
    );
  }
  return root;
}

export async function usage(): Promise<Usage> {
  const root = await ensureHome();
  let files = 0;
  let bytes = 0;
  const folders: Usage["folders"] = [];

  for (const folder of HOME_FOLDERS) {
    let count = 0;
    let size = 0;
    const walk = async (dir: string, depth: number) => {
      if (depth > 4) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        try {
          if (entry.isDirectory()) {
            if (entry.name.startsWith(".")) continue;
            await walk(full, depth + 1);
          } else if (entry.isFile()) {
            const info = await stat(full);
            count += 1;
            size += info.size;
          }
        } catch {
          /* unreadable entries are skipped, not fatal */
        }
      }
    };
    await walk(join(root, folder), 0);
    files += count;
    bytes += size;
    if (count > 0) folders.push({ name: folder, files: count, bytes: size });
  }

  return { root, files, bytes, quotaBytes: quotaBytes(), folders };
}

// ── operations ─────────────────────────────────────────────────────────────

export async function listDir(rel = ""): Promise<{ path: string; entries: Entry[] }> {
  const abs = await safePath(rel);
  const info = await stat(abs).catch(() => null);
  if (!info) throw new SandboxError("Folder not found", 404);
  if (!info.isDirectory()) throw new SandboxError("Not a folder", 400);

  const dirents = await readdir(abs, { withFileTypes: true });
  const entries: Entry[] = [];
  for (const dirent of dirents) {
    if (dirent.name.startsWith(".")) continue;
    const full = join(abs, dirent.name);
    try {
      const s = await stat(full);
      entries.push({
        name: dirent.name,
        path: await relativePath(full),
        type: dirent.isDirectory() ? "dir" : "file",
        bytes: dirent.isDirectory() ? 0 : s.size,
        modifiedAt: s.mtime.toISOString(),
      });
    } catch {
      /* skip entries that vanish mid-listing */
    }
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  return { path: await relativePath(abs), entries };
}

export async function readText(
  rel: string,
  maxBytes = MAX_READ,
): Promise<{ path: string; content: string; bytes: number; truncated: boolean }> {
  const abs = await safePath(rel);
  const info = await stat(abs).catch(() => null);
  if (!info || !info.isFile()) throw new SandboxError("File not found", 404);
  if (info.size > maxBytes) {
    const buf = await readFile(abs);
    return {
      path: await relativePath(abs),
      content: buf.subarray(0, maxBytes).toString("utf8"),
      bytes: info.size,
      truncated: true,
    };
  }
  return {
    path: await relativePath(abs),
    content: await readFile(abs, "utf8"),
    bytes: info.size,
    truncated: false,
  };
}

export async function writeText(
  rel: string,
  content: string,
  opts: { overwrite?: boolean } = {},
): Promise<{ path: string; bytes: number; created: boolean }> {
  const abs = await safePath(rel);
  if (content.length > MAX_WRITE) throw new SandboxError("Content is too large for one write", 413);

  const existing = await stat(abs).catch(() => null);
  if (existing && !opts.overwrite) throw new SandboxError("File already exists — overwrite is a level 3 action", 409);
  if (existing && existing.isDirectory()) throw new SandboxError("That path is a folder", 400);

  const current = await usage();
  if (current.bytes + Buffer.byteLength(content) > current.quotaBytes) {
    throw new SandboxError("AI home storage quota reached", 507);
  }

  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
  return { path: await relativePath(abs), bytes: Buffer.byteLength(content), created: !existing };
}

export async function makeFolder(rel: string): Promise<{ path: string; created: boolean }> {
  const abs = await safePath(rel);
  const existing = await stat(abs).catch(() => null);
  if (existing?.isDirectory()) return { path: await relativePath(abs), created: false };
  if (existing) throw new SandboxError("A file already has that name", 409);
  await mkdir(abs, { recursive: true });
  return { path: await relativePath(abs), created: true };
}

/** Existence check that still enforces the sandbox. */
export async function exists(rel: string): Promise<boolean> {
  const abs = await safePath(rel);
  return (await stat(abs).catch(() => null)) !== null;
}

export async function statOf(rel: string): Promise<{ type: "file" | "dir"; bytes: number } | null> {
  const abs = await safePath(rel);
  const info = await stat(abs).catch(() => null);
  if (!info) return null;
  return { type: info.isDirectory() ? "dir" : "file", bytes: info.size };
}

export async function movePath(from: string, to: string): Promise<{ from: string; to: string }> {
  const absFrom = await safePath(from);
  const absTo = await safePath(to);
  const source = await stat(absFrom).catch(() => null);
  if (!source) throw new SandboxError("Source not found", 404);
  const target = await stat(absTo).catch(() => null);
  if (target) throw new SandboxError("Destination already exists", 409);
  await mkdir(dirname(absTo), { recursive: true });
  await rename(absFrom, absTo);
  return { from: await relativePath(absFrom), to: await relativePath(absTo) };
}

/** Deleting means moving into `.trash/`, which is recoverable by hand. */
export async function trashPath(rel: string): Promise<{ path: string; trashedTo: string }> {
  const abs = await safePath(rel);
  const info = await stat(abs).catch(() => null);
  if (!info) throw new SandboxError("Path not found", 404);
  const trashDir = join(homeRoot(), ".trash");
  await mkdir(trashDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = join(trashDir, `${stamp}__${basename(abs)}`);
  await rename(abs, dest);
  return { path: rel, trashedTo: await relativePath(dest) };
}

export async function searchFiles(
  query: string,
  limit = 25,
): Promise<Array<{ path: string; name: string; bytes: number; snippet: string }>> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const root = await ensureHome();
  const results: Array<{ path: string; name: string; bytes: number; snippet: string }> = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (results.length >= limit || depth > 4) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= limit) return;
      if (entry.name.startsWith(".") || entry.name === "security" || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      const nameHit = entry.name.toLowerCase().includes(q);
      const ext = extname(entry.name).toLowerCase();
      let snippet = "";
      if (TEXT_EXT.has(ext)) {
        try {
          const s = await stat(full);
          if (s.size > MAX_READ) continue;
          const text = await readFile(full, "utf8");
          const idx = text.toLowerCase().indexOf(q);
          if (idx >= 0) snippet = text.slice(Math.max(0, idx - 60), idx + 140).replace(/\s+/g, " ");
          else if (!nameHit) continue;
        } catch {
          if (!nameHit) continue;
        }
      } else if (!nameHit) {
        continue;
      }
      const s = await stat(full).catch(() => null);
      results.push({
        path: await relativePath(full),
        name: entry.name,
        bytes: s?.size ?? 0,
        snippet: snippet.trim(),
      });
    }
  };

  await walk(root, 0);
  return results;
}

export interface SystemInfo {
  platform: string;
  release: string;
  arch: string;
  cpus: number;
  cpuModel: string;
  memoryTotalGb: number;
  memoryFreeGb: number;
  uptimeHours: number;
  loadAvg: number[];
  nodeVersion: string;
  measuredAt: string;
}

/** Real measurements from the machine hosting this app. */
export function systemInfo(): SystemInfo {
  const cpus = os.cpus();
  return {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpus: cpus.length,
    cpuModel: cpus[0]?.model.trim() ?? "unknown",
    memoryTotalGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    memoryFreeGb: Math.round((os.freemem() / 1024 ** 3) * 10) / 10,
    uptimeHours: Math.round((os.uptime() / 3600) * 10) / 10,
    loadAvg: os.loadavg().map((n) => Math.round(n * 100) / 100),
    nodeVersion: process.version,
    measuredAt: new Date().toISOString(),
  };
}
