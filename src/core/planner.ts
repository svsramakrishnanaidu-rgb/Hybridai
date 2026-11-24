/**
 * HYDRO AI — instruction → action plan.
 *
 * A deterministic parser, not a model call. It is fast, free, auditable and
 * cannot be talked into a step it does not have a rule for. Anything it does not
 * understand is left alone (`handled: false`) so the conversation can answer it
 * instead of guessing at a file operation.
 *
 * Telugu and Telugu-English verbs are recognised alongside English, because the
 * rest of the app is built for mixed-language conversation.
 *
 * Pure module: no imports, no I/O — the matching logic is unit-testable.
 */

export type PlanRisk = "low" | "medium";

export interface PlanStep {
  tool: "home.list" | "home.read" | "home.search" | "home.write" | "home.mkdir" | "home.move" | "home.trash" | "system.info";
  args: Record<string, unknown>;
  note: string;
}

export interface Plan {
  handled: boolean;
  intent: string;
  steps: PlanStep[];
  summary: string;
  needsClarification: string | null;
  requiresApproval: boolean;
  risk: PlanRisk;
}

const FOLDERS = new Set([
  "brain", "memory", "knowledge", "learning", "tools", "skills", "projects",
  "workspace", "vision", "voice", "hologram", "backups", "diagnostics", "security", "updates",
]);

const FOLDER_WORDS: Record<string, string> = {
  projects: "projects",
  project: "projects",
  documents: "projects",
  docs: "projects",
  notes: "projects",
  workspace: "workspace",
  knowledge: "knowledge",
  research: "knowledge",
  memory: "memory",
  brain: "brain",
  vision: "vision",
  voice: "voice",
  holo: "hologram",
  hologram: "hologram",
  backups: "backups",
  backup: "backups",
  diagnostics: "diagnostics",
  learning: "learning",
  skills: "skills",
  tools: "tools",
  downloads: "workspace",
};

const FILE_RE =
  /([\w][\w .\-@()]*?\.(?:md|txt|json|csv|ts|tsx|js|jsx|py|rb|go|rs|java|c|cpp|h|css|html|yml|yaml|toml|sql|sh|log|xml|svg))/i;

const STOP = new Set([
  "the", "a", "an", "my", "our", "this", "that", "it", "file", "folder", "directory",
  "called", "named", "as", "to", "into", "please", "for", "me", "in", "from", "new",
]);

function unquote(value: string): string {
  return value.replace(/^["'`]|["'`]$/g, "").trim();
}

/** Strip filler words while keeping a usable path. */
function cleanTarget(raw: string): string {
  return unquote(raw)
    .replace(/[.,;!?]+$/g, "")
    .replace(/\b(please|now|for me)\b/gi, "")
    .trim()
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w.toLowerCase()))
    .join(" ");
}

function folderFor(word: string): string {
  const key = word.toLowerCase();
  if (FOLDERS.has(key)) return key;
  return FOLDER_WORDS[key] ?? `projects/${word.replace(/[^\w\-. ]/g, "").trim()}`;
}

function resolvePath(raw: string): string | null {
  const cleaned = cleanTarget(raw);
  if (!cleaned) return null;
  if (cleaned.includes("/")) return cleaned.replace(/^\/+/, "");
  const file = cleaned.match(FILE_RE);
  if (file) return `projects/${file[1].trim()}`;
  return folderFor(cleaned);
}

function plan(intent: string, steps: PlanStep[], summary: string, extra: Partial<Plan> = {}): Plan {
  return {
    handled: steps.length > 0,
    intent,
    steps,
    summary,
    needsClarification: null,
    requiresApproval: steps.some((s) => s.tool === "home.trash" || s.tool === "home.move"),
    risk: steps.some((s) => s.tool === "home.trash" || s.tool === "home.move") ? "medium" : "low",
    ...extra,
  };
}

export function planInstruction(raw: string): Plan {
  const text = (raw ?? "").trim();
  if (!text) return plan("empty", [], "", { handled: false });

  const lower = text.toLowerCase();

  // ── workflows are routed by the caller, not executed as file steps ────────
  if (
    /(run|execute|do|repeat|perform|apply)\b.{0,40}\b(workflow|process|steps?|same task|same thing|procedure)\b/.test(
      lower,
    ) ||
    /\b(repeat|redo)\b.{0,20}\b(that|this|it)\b/.test(lower)
  ) {
    return {
      handled: false,
      intent: "workflow.run",
      steps: [],
      summary: "Run a previously approved workflow",
      needsClarification: null,
      requiresApproval: false,
      risk: "low",
    };
  }

  // ── learning a workflow from a narration ─────────────────────────────────
  if (
    /(learn|remember|watch)\b.{0,50}\b(process|workflow|steps?|how i|demonstration)\b/.test(lower) ||
    /(జ్ఞాపకం|నేర్చుకో)/.test(text)
  ) {
    return {
      handled: false,
      intent: "workflow.learn",
      steps: [],
      summary: "Learn a workflow",
      needsClarification: null,
      requiresApproval: false,
      risk: "low",
    };
  }

  // ── machine status ────────────────────────────────────────────────────────
  if (
    /\b(cpu|gpu|ram|memory usage|system|computer|laptop|machine|disk|storage space|performance|health)\b/.test(lower) &&
    /\b(check|status|info|information|usage|how much|how is|monitor|report)\b/.test(lower)
  ) {
    return plan("system.info", [{ tool: "system.info", args: {}, note: "Read real OS metrics" }], "Report machine status");
  }

  // ── read a specific file ─────────────────────────────────────────────────
  const fileInText = text.match(FILE_RE)?.[1];
  if (fileInText && /\b(read|open|view|show|display|చూపించు|తెరవండి)\b/i.test(text) && !/\bfolder|directory\b/i.test(text)) {
    const rel = resolvePath(fileInText)!;
    return plan("home.read", [{ tool: "home.read", args: { path: rel }, note: `Read ${rel}` }], `Read ${rel}`);
  }

  // ── search the home ──────────────────────────────────────────────────────
  const search = text.match(/\b(?:find|search(?:\s+for)?|look\s+for|locate|వెతుకు)\b\s+(.+)$/i);
  if (search) {
    const query = cleanTarget(
      search[1].replace(/\b(in|inside|across)\b.{0,30}\b(files?|folders?|home|storage|workspace)\b/gi, ""),
    );
    if (query.length >= 2) {
      return plan("home.search", [{ tool: "home.search", args: { query }, note: `Search for "${query}"` }], `Search files for "${query}"`);
    }
  }

  // ── list a folder ────────────────────────────────────────────────────────
  const listMatch =
    text.match(/\b(?:list|show|what(?:'s| is) (?:in|inside)|browse|చూపించు)\b\s*(?:me\s+)?(?:the\s+|my\s+)?(.+?)?\s*(?:folder|directory|contents|files)?\s*$/i) ??
    text.match(/^(?:ls|dir)\s*(.*)$/i);
  if (listMatch && /\b(list|show|what|browse|ls|dir|చూపించు)\b/i.test(text)) {
    const cleaned = cleanTarget(listMatch[1] ?? "");
    const rel = cleaned ? resolvePath(cleaned) : "";
    return plan("home.list", [{ tool: "home.list", args: { path: rel ?? "" }, note: `List ${rel || "the home"} ` }], `List ${rel || "the AI home"}`);
  }

  // ── move / rename ────────────────────────────────────────────────────────
  const mv = text.match(/\b(?:move|rename)\b\s+(.+?)\s+(?:to|into|as)\s+(.+)$/i);
  if (mv) {
    const from = resolvePath(mv[1]);
    const to = resolvePath(mv[2]);
    if (!from || !to) {
      return plan("home.move", [], "Move a file", { needsClarification: "Tell me both the current and the new path." });
    }
    return plan(
      "home.move",
      [{ tool: "home.move", args: { from, to }, note: `Move ${from} → ${to}` }],
      `Move ${from} to ${to}`,
      { requiresApproval: true, risk: "medium" },
    );
  }

  // ── delete → recoverable trash ───────────────────────────────────────────
  const del = text.match(/\b(?:delete|remove|trash|తొలగించు)\b\s+(.+)$/i);
  if (del) {
    const rel = resolvePath(del[1]);
    if (!rel) {
      return plan("home.trash", [], "Move to trash", { needsClarification: "Which file or folder should I move to the trash?" });
    }
    return plan(
      "home.trash",
      [{ tool: "home.trash", args: { path: rel }, note: `Move ${rel} to .trash` }],
      `Move ${rel} to the trash (recoverable)`,
      { requiresApproval: true, risk: "medium" },
    );
  }

  // ── new folder ───────────────────────────────────────────────────────────
  const mkdirMatch = text.match(/\b(?:create|make|new|add|సృష్టించు)\b\s+(?:a\s+|an\s+)?(?:new\s+)?(?:folder|directory)\b\s*(?:called|named|as)?\s*(.+)?$/i);
  if (mkdirMatch) {
    const rel = resolvePath(mkdirMatch[1] ?? "");
    if (!rel) {
      return plan("home.mkdir", [], "Create a folder", { needsClarification: "What should the folder be called?" });
    }
    return plan("home.mkdir", [{ tool: "home.mkdir", args: { path: rel }, note: `Create folder ${rel}` }], `Create folder ${rel}`);
  }

  // ── save a note / create a file ──────────────────────────────────────────
  const save = text.match(/\b(?:save|write|store)\b\s+(?:this|that|it)\b(?:\s+(?:as|to|in))?\s+(.+)$/i);
  if (save) {
    const rel = resolvePath(save[1]);
    if (!rel) {
      return plan("home.write", [], "Save a note", { needsClarification: "What filename should I use?" });
    }
    // "save this as notes.md" names a destination but the engine has no text to
    // put in it. Writing an empty file and reporting success was a false claim,
    // so this asks for the content instead.
    return plan("home.write", [], `Save text to ${rel}`, {
      needsClarification: `I can only save text you give me. Paste what should go into ${rel}, or create the file in the workspace panel.`,
    });
  }

  const createFile = text.match(/\b(?:create|make|new|add|write|సృష్టించు)\b\s+(?:a\s+|an\s+)?(?:new\s+)?(?:file|note|document)\b\s*(?:called|named|as)?\s*(.*)$/i);
  if (createFile) {
    const rel = resolvePath(createFile[1]);
    if (!rel) {
      return plan("home.write", [], "Create a file", { needsClarification: "What should the file be called?" });
    }
    return plan("home.write", [{ tool: "home.write", args: { path: rel, content: "" }, note: `Create ${rel}` }], `Create ${rel}`);
  }

  // ── open by name without a filename extension ────────────────────────────
  const openWord = text.match(/\b(?:open|show)\b\s+(?:my\s+)?(projects?|knowledge|memory|workspace|backups?|diagnostics|vision|voice)\b/i);
  if (openWord) {
    const rel = folderFor(openWord[1]);
    return plan("home.list", [{ tool: "home.list", args: { path: rel }, note: `List ${rel}` }], `Open ${rel}`);
  }

  return {
    handled: false,
    intent: "conversation",
    steps: [],
    summary: "",
    needsClarification: null,
    requiresApproval: false,
    risk: "low",
  };
}

/**
 * Expand user-defined phrases before planning. Longest aliases win, so a phrase
 * is never partially replaced by a shorter one. Pure.
 */
export function applyPhraseAliases(
  text: string,
  aliases: Array<{ alias: string; canonical: string }>,
): string {
  if (!aliases.length) return text;
  let out = text;
  for (const alias of [...aliases].sort((a, b) => b.alias.length - a.alias.length)) {
    if (!alias.alias.trim()) continue;
    const escaped = alias.alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "gi"), alias.canonical);
  }
  return out;
}

/** Human-readable one-liner for a plan card. */
export function describePlan(p: Plan): string {
  if (!p.steps.length) return p.needsClarification ?? "No executable step.";
  return p.steps.map((s) => `• ${s.note}`).join("\n");
}
