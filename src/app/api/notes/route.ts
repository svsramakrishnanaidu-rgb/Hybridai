import {
  getLevel,
  levelAllows,
  logAudit,
  listDir,
  readText,
  requiredLevelFor,
  searchFiles,
  trashPath,
  writeText,
} from "@/core/ai-home";
import { ownerDenied } from "@/core/owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Project notes.
 *
 * A note is a real Markdown file inside HYDRO's sandbox, under
 * `projects/<project>/notes/`. Saving is verified by reading the file back, so
 * "saved" always means the bytes are on disk. Anything outside `projects/` is
 * refused even though the sandbox would already block it.
 */

interface NoteRecord {
  path: string;
  project: string;
  title: string;
  bytes: number;
  modifiedAt: string | null;
}

function projectSlug(raw: unknown): string {
  const slug = String(raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(slug) ? slug : "general";
}

function titleOf(name: string): string {
  return name
    .replace(/\.md$/i, "")
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .replace(/-/g, " ")
    .trim();
}

function fileSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "note";
}

function isNotePath(path: string): boolean {
  return /^projects\/[a-z0-9][a-z0-9-]*\/notes\/[^/]+\.md$/i.test(path);
}

async function listProject(project: string, limit: number): Promise<NoteRecord[]> {
  const notes: NoteRecord[] = [];
  const { entries } = await listDir(`projects/${project}/notes`).catch(() => ({
    path: "",
    entries: [],
  }));
  for (const entry of entries) {
    if (entry.type !== "file" || !entry.name.toLowerCase().endsWith(".md")) continue;
    notes.push({
      path: `projects/${project}/notes/${entry.name}`,
      project,
      title: titleOf(entry.name),
      bytes: entry.bytes,
      modifiedAt: entry.modifiedAt ?? null,
    });
  }
  return notes.slice(0, limit);
}

export async function GET(req: Request) {
  const ownerBlock = ownerDenied(req);
  if (ownerBlock) return ownerBlock;
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  const query = url.searchParams.get("q");
  const project = url.searchParams.get("project");

  try {
    if (path) {
      if (!isNotePath(path)) {
        return Response.json({ error: "Only project notes can be opened here." }, { status: 403 });
      }
      const file = await readText(path);
      return Response.json(
        { ...file, title: titleOf(path.split("/").pop() ?? "") },
        { headers: { "cache-control": "no-store" } },
      );
    }

    if (query) {
      const hits = (await searchFiles(query, 40)).filter((hit) => hit.path.startsWith("projects/"));
      return Response.json(
        { notes: hits.map((hit) => ({ ...hit, project: hit.path.split("/")[1] ?? "general" })) },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const projects = project
      ? [projectSlug(project)]
      : (await listDir("projects").catch(() => ({ path: "", entries: [] }))).entries
          .filter((entry) => entry.type === "dir")
          .map((entry) => entry.name);

    const notes: NoteRecord[] = [];
    for (const name of projects.slice(0, 20)) {
      notes.push(...(await listProject(projectSlug(name), 100)));
    }
    notes.sort((a, b) => (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? ""));
    return Response.json(
      { notes: notes.slice(0, 100), project: project ? projectSlug(project) : null },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not read project notes" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}

interface Body {
  project?: unknown;
  title?: unknown;
  content?: unknown;
  source?: unknown;
}

export async function POST(req: Request) {
  const ownerBlock = ownerDenied(req);
  if (ownerBlock) return ownerBlock;
  const body = (await req.json().catch(() => ({}))) as Body;
  const project = projectSlug(body.project);
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const title = (typeof body.title === "string" ? body.title : "").trim().slice(0, 120);
  const source =
    typeof body.source === "string" && body.source.trim() ? body.source.trim().slice(0, 200) : "HYDRO";

  if (content.length < 1) {
    return Response.json({ error: "Nothing to save — the note is empty." }, { status: 400 });
  }
  if (content.length > 120_000) {
    return Response.json({ error: "That note is too large to save in one write." }, { status: 413 });
  }

  const level = await getLevel();
  if (!levelAllows(level, "home.write")) {
    return Response.json(
      {
        error: `Saving a note needs permission level ${requiredLevelFor("home.write")} (Create). Current level: ${level}. Raise it in the workspace panel.`,
      },
      { status: 403 },
    );
  }

  const safeTitle = title || "HYDRO note";
  const stamp = new Date().toISOString().slice(0, 10);
  let path = `projects/${project}/notes/${stamp}-${fileSlug(safeTitle)}.md`;
  let suffix = 1;
  for (; suffix < 20; suffix += 1) {
    try {
      await readText(path);
      path = `projects/${project}/notes/${stamp}-${fileSlug(safeTitle)}-${suffix}.md`;
    } catch {
      break;
    }
  }

  const markdown = [
    `# ${safeTitle}`,
    "",
    `- Project: ${project}`,
    `- Saved: ${new Date().toISOString()}`,
    `- Source: ${source}`,
    "",
    "---",
    "",
    content,
    "",
  ].join("\n");

  try {
    const written = await writeText(path, markdown);
    // Verify against the filesystem, not against the write call's own claim.
    const check = await readText(path);
    if (!check.content.includes(content.slice(0, 200))) {
      return Response.json({ error: "The file was written but did not read back correctly." }, { status: 500 });
    }
    await logAudit("notes.save", `${path} (${written.bytes} bytes, verified)`);
    return Response.json({
      note: { path, project, title: safeTitle, createdAt: new Date().toISOString() },
      bytes: written.bytes,
      verified: true,
      level,
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not save the note" },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request) {
  const ownerBlock = ownerDenied(req);
  if (ownerBlock) return ownerBlock;
  const path = new URL(req.url).searchParams.get("path") ?? "";
  if (!isNotePath(path)) {
    return Response.json({ error: "Only project notes can be removed here." }, { status: 403 });
  }
  const level = await getLevel();
  if (!levelAllows(level, "home.trash")) {
    return Response.json(
      {
        error: `Removing a note needs permission level ${requiredLevelFor("home.trash")} (Manage). Current level: ${level}.`,
      },
      { status: 403 },
    );
  }
  try {
    const moved = await trashPath(path);
    await logAudit("notes.trash", `${path} → ${moved.trashedTo}`);
    return Response.json({ removed: true, trashedTo: moved.trashedTo });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not remove the note" },
      { status: 400 },
    );
  }
}

