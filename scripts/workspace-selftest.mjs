/**
 * HYDRO AI — workspace, planner and pose self-test.
 *
 * Exercises the real modules against a throwaway AI home in the OS temp folder.
 * Nothing here touches the project's own .data state, and the permission file is
 * redirected with HYDRO_PERM_FILE.
 *
 * Run: npm run workspace:test
 */

import { mkdtemp, rm, readdir } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";

const temp = await mkdtemp(join(tmpdir(), "hydro-workspace-"));
process.env.HYDRO_AI_HOME = join(temp, "ai-home");
process.env.HYDRO_PERM_FILE = join(temp, "permissions.json");
process.env.HYDRO_HOME_QUOTA_MB = "1";

const home = await import("../src/core/ai-home.ts");
const { planInstruction, applyPhraseAliases } = await import("../src/core/planner.ts");
const { buildClaimGraph } = await import("../src/core/claims.ts");
const { normalizeStore, addMemory, retrieve } = await import("../src/core/memory.ts");
const { isTrivialTurn } = await import("../src/core/classify.ts");
const { poseSignature, signatureDistance, matchTemplate } = await import("../src/lib/vision/pose.ts");

let passed = 0;
let failed = 0;

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function rejects(name, fn, status) {
  try {
    await fn();
    check(name, false, "resolved instead of throwing");
  } catch (err) {
    check(name, status === undefined || err.status === status, `status ${err.status}: ${err.message}`);
  }
}

console.log("\nsandbox");
{
  const root = await home.ensureHome();
  check("home root exists", root.endsWith("ai-home"));
  const listing = await home.listDir("");
  const names = listing.entries.map((e) => e.name);
  check("home has the expected folders", names.includes("projects") && names.includes("knowledge") && names.includes("diagnostics"));
  check("home README is present", names.includes("README.md"));

  await rejects("parent traversal is refused", () => home.safePath("../outside"), 403);
  await rejects("nested traversal is refused", () => home.safePath("projects/../../outside"), 403);
  await rejects("absolute Windows path is refused", () => home.safePath("C:\\Windows\\System32"), 403);
  await rejects("credential file is refused", () => home.safePath("security/.env"), 403);
  await rejects("null byte is refused", () => home.safePath("projects/a\u0000b"), 400);
}

console.log("\nfile operations");
{
  const written = await home.writeText("projects/notes.md", "# Notes\n\nhello hydro");
  check("write creates a file", written.created === true && written.bytes > 0);

  const read = await home.readText("projects/notes.md");
  check("read returns the written text", read.content.includes("hello hydro"));

  await rejects("create-only refuses to overwrite", () => home.writeText("projects/notes.md", "changed"), 409);
  const overwritten = await home.writeText("projects/notes.md", "changed", { overwrite: true });
  check("explicit overwrite works", overwritten.bytes === 7);

  await home.makeFolder("projects/plans");
  const listing = await home.listDir("projects");
  check("listing shows the new folder", listing.entries.some((e) => e.name === "plans" && e.type === "dir"));

  const hits = await home.searchFiles("hello");
  check("content search finds the older text", hits.length === 0, `unexpected hits: ${hits.length}`);

  await home.writeText("knowledge/caching.md", "HTTP caching stores responses to cut repeated work.");
  const hit = await home.searchFiles("caching");
  check("content search finds a knowledge file", hit.some((h) => h.path === "knowledge/caching.md"));

  const moved = await home.movePath("projects/notes.md", "projects/notes-final.md");
  check("move reports the new path", moved.to === "projects/notes-final.md");
  check("move removes the source", !(await home.exists("projects/notes.md")));
  check("move keeps the destination", await home.exists("projects/notes-final.md"));

  const trashed = await home.trashPath("projects/notes-final.md");
  check("trash returns a restorable location", trashed.trashedTo.includes(".trash"));
  check("trash removes the original path", !(await home.exists("projects/notes-final.md")));
}

console.log("\npermissions");
{
  check("level 1 can observe", home.levelAllows(1, "home.read") === true);
  check("level 1 cannot create", home.levelAllows(1, "home.write") === false);
  check("level 2 can create", home.levelAllows(2, "home.mkdir") === true);
  check("level 2 cannot delete", home.levelAllows(2, "home.trash") === false);
  check("level 3 can delete", home.levelAllows(3, "home.trash") === true);

  await home.setLevel(3);
  const level = await home.getLevel();
  check("level round-trips through disk", level === 3, `got ${level}`);
  await home.setLevel(4);
  check("level 4 is not grantable", (await home.getLevel()) === 2);
  await home.setLevel(2);
}

console.log("\nquota");
{
  const chunk = "x".repeat(400_000);
  await home.writeText("workspace/a.txt", chunk);
  await home.writeText("workspace/b.txt", chunk);
  let blocked = false;
  try {
    await home.writeText("workspace/c.txt", chunk);
  } catch (err) {
    blocked = err.status === 507;
  }
  check("quota blocks the write that would exceed it", blocked);
  const usage = await home.usage();
  check("usage stays under quota", usage.bytes <= usage.quotaBytes, `${usage.bytes}/${usage.quotaBytes}`);
}

console.log("\nplanner");
{
  const cases = [
    ["create a file called notes.md", "home.write"],
    ["make a folder called research-notes", "home.mkdir"],
    ["list my projects folder", "home.list"],
    ["what is in my knowledge folder", "home.list"],
    ["read plan.md", "home.read"],
    ["find caching", "home.search"],
    ["delete old-draft.md", "home.trash"],
    ["check my laptop performance", "system.info"],
  ];
  for (const [text, tool] of cases) {
    const plan = planInstruction(text);
    check(`"${text}" → ${tool}`, plan.handled && plan.steps[0]?.tool === tool, plan.steps[0]?.tool ?? plan.intent);
  }

  const conversation = planInstruction("what is a neural network?");
  check("a question is not turned into a file operation", conversation.handled === false);

  const trash = planInstruction("delete notes.md");
  check("deletion asks for approval", trash.requiresApproval === true && trash.risk === "medium");

  const unclear = planInstruction("create a file");
  check("an incomplete instruction asks for clarification", Boolean(unclear.needsClarification));

  const wfRun = planInstruction("do the same task again");
  check("workflow replay is recognised", wfRun.intent === "workflow.run");

  const taught = applyPhraseAliases("open work", [
    { alias: "open work", canonical: "list my projects folder" },
  ]);
  check("a taught phrase expands", taught === "list my projects folder");
  check("an expanded phrase plans correctly", planInstruction(taught).steps[0]?.tool === "home.list");

  // "save this as X" names a destination but no text. Writing an empty file and
  // reporting success was a false claim; it must ask for the content instead.
  const saveThis = planInstruction("save this as notes.md");
  check(
    "save-this asks for the text instead of writing an empty file",
    saveThis.handled === false && Boolean(saveThis.needsClarification),
    JSON.stringify(saveThis.steps),
  );
}

console.log("\nclaim graph");
{
  const agree = buildClaimGraph({
    drafts: [
      { modelId: "a", text: "Caching improves latency because repeated reads skip the origin server entirely." },
      { modelId: "b", text: "Caching improves latency because repeated reads skip the origin server entirely." },
    ],
    evidence: [],
  });
  check("two identical drafts corroborate a claim", agree.some((c) => c.status === "corroborated"));
  check("agreeing drafts record no contradiction", agree.every((c) => c.contradicts.length === 0));

  const split = buildClaimGraph({
    drafts: [
      { modelId: "a", text: "Caching improves latency because repeated reads skip the origin server entirely." },
      { modelId: "b", text: "Caching does not improve latency because repeated reads still hit the origin server entirely." },
    ],
    evidence: [],
  });
  check(
    "opposite assertions are recorded as a contradiction",
    split.filter((c) => c.contradicts.length > 0).length === 2,
    `${split.filter((c) => c.contradicts.length > 0).length} flagged`,
  );
  check(
    "a contradiction is never counted as corroboration",
    split.every((c) => !(c.contradicts.length > 0 && c.status === "corroborated")),
  );
}

console.log("\nmemory store");
{
  const corrupt = normalizeStore({
    memory: "not-an-array",
    audit: null,
    usage: { calls: "7" },
    settings: { memoryEnabled: "yes" },
    stats: [],
  });
  check("a corrupt store is repaired instead of crashing", Array.isArray(corrupt.memory) && Array.isArray(corrupt.audit));
  check("settings keep only real booleans", corrupt.settings.memoryEnabled === false);
  check("numeric usage is recovered from a string", corrupt.usage.calls === 7);
  check("a non-object stats field is replaced", typeof corrupt.stats === "object" && !Array.isArray(corrupt.stats));

  const store = normalizeStore({});
  addMemory(store, { type: "episodic", content: "Asked: what is a hash table", source: "t", consentRef: "t" });
  addMemory(store, { type: "episodic", content: "Asked: what is a hash table", source: "t", consentRef: "t" });
  check("an identical memory is stored once", store.memory.length === 1, `${store.memory.length} records`);
  const hits = retrieve(store, "what is a hash table");
  check("retrieval still finds the record", hits.length === 1);
  check("a different memory is still added", (() => {
    addMemory(store, { type: "preference", content: "I prefer short answers", source: "t", consentRef: "t" });
    return store.memory.length === 2;
  })());
}

console.log("\nturn complexity");
{
  check("a greeting is a simple turn", isTrivialTurn("hi") === true);
  check("thanks is a simple turn", isTrivialTurn("Thank you!") === true);
  check("a Telugu greeting is a simple turn", isTrivialTurn("నమస్కారం") === true);
  check("a short question is not a simple turn", isTrivialTurn("what is a hash table?") === false);
  check("a request is not a simple turn", isTrivialTurn("explain recursion") === false);
}

console.log("\npose matching");
{
  const base = Array.from({ length: 21 }, (_, i) => ({
    x: 0.5 + Math.sin(i) * 0.08,
    y: 0.6 - i * 0.01,
  }));
  base[0] = { x: 0.5, y: 0.7 };
  base[9] = { x: 0.5, y: 0.5 };

  const sig = poseSignature(base);
  check("signature has 42 values", sig?.length === 42);

  const shifted = base.map((p) => ({ x: p.x + 0.2, y: p.y - 0.1 }));
  const scaled = base.map((p) => ({ x: 0.5 + (p.x - 0.5) * 1.8, y: 0.7 + (p.y - 0.7) * 1.8 }));
  check("translation does not change the pose", signatureDistance(sig, poseSignature(shifted)) < 0.02);
  check("scale does not change the pose", signatureDistance(sig, poseSignature(scaled)) < 0.02);

  const mirrored = base.map((p) => ({ x: 1 - p.x, y: p.y }));
  check("a mirrored hand is a different pose", signatureDistance(sig, poseSignature(mirrored)) > 0.22);

  const template = { id: "pose_1", name: "Fist", command: "list my projects", signature: sig };
  check("matching finds the stored template", matchTemplate(poseSignature(shifted), [template])?.template.id === "pose_1");
  check("unrelated hands do not match", matchTemplate(poseSignature(mirrored), [template]) === null);
  check("a signature requires 21 points", poseSignature(base.slice(0, 12)) === null);
}

console.log("\naudit");
{
  const entries = await home.readAudit(50);
  check("permission changes are audited", entries.some((e) => e.action.startsWith("permissions.")));
}

console.log("\nenvironment awareness");
{
  const env = await import("../src/core/environment.ts");
  const snap = await env.readEnvironment({ online: true, battery: { level: 0.5, charging: false } });

  check("environment reads the real platform", snap.platform.startsWith(process.platform), snap.platform);
  check("environment reports the real cpu count", snap.cpus === cpus().length, String(snap.cpus));
  check("environment reports a permission level name", typeof snap.levelName === "string" && snap.levelName.length > 2);
  check("environment reports real free memory", snap.memoryFreeGb > 0 && snap.memoryFreeGb <= snap.memoryTotalGb);

  const block = env.environmentBlock(snap);
  check("the block carries the measured clock", block.includes("Local time"));
  check("the block carries real resources", /GB free/.test(block));
  check("the block carries browser facts", block.includes("online") && block.includes("50%"));
  check(
    "the block tells the model not to recite or over-claim",
    block.includes("Do not recite") && block.includes("never claim control"),
  );

  const secrets = [
    process.env.DEEPGRAM_API_KEY,
    process.env.ELEVENLABS_API_KEY,
    process.env.TAVILY_API_KEY,
  ].filter(Boolean);
  check("the block contains no configured key", secrets.every((s) => !block.includes(s)));

  check("battery level is clamped into 0…1", env.normalizeDevice({ battery: { level: 4.2 } })?.battery?.level === 1);
  check("a negative battery is clamped to 0", env.normalizeDevice({ battery: { level: -3 } })?.battery?.level === 0);
  check("garbage device facts are rejected", env.normalizeDevice({ battery: { level: "high" } }) === null);
  check("a bare connectivity flag survives", env.normalizeDevice({ online: false })?.online === false);

  const offline = env.environmentBlock(await env.readEnvironment({ online: false }));
  check("offline is reported when the browser says so", offline.includes("offline"));
  check("an unknown battery is omitted, not invented", !offline.includes("Battery"));

  const { buildSystemPrompt } = await import("../src/core/identity.ts");
  const prompt = buildSystemPrompt({
    profile: {
      language: "en",
      domain: "general",
      complexity: 0,
      needsEvidence: false,
      risk: "low",
      tokenBudget: 1000,
    },
    memories: [],
    memoryEnabled: false,
    environment: block,
  });
  check("the environment block reaches the system prompt", prompt.includes("CURRENT ENVIRONMENT"));
  check(
    "an empty environment adds nothing to the prompt",
    !buildSystemPrompt({
      profile: { language: "en", domain: "general", complexity: 0, needsEvidence: false, risk: "low", tokenBudget: 1000 },
      memories: [],
      memoryEnabled: false,
    }).includes("CURRENT ENVIRONMENT"),
  );
}

console.log("\nemergency stop");
{
  // The execution history is written relative to the working directory, so the
  // whole run happens inside the throwaway folder.
  const origin = process.cwd();
  process.chdir(temp);
  await home.setLevel(2);
  const { executePlan, requestCancel } = await import("../src/core/actions.ts");

  // Real directory reads, so the run lasts long enough to be interrupted. A
  // batch of in-memory steps would finish before any timer could fire.
  const steps = Array.from({ length: 1000 }, () => ({ tool: "home.list", args: { path: "" } }));
  const plan = { intent: "cancel.test", summary: "", steps, requiresApproval: false, risk: "low" };

  const running = executePlan(plan, "cancel test");
  await new Promise((r) => setTimeout(r, 1));
  requestCancel();
  const record = await running;

  check("an emergency stop mid-run is recorded", record.cancelled === true, `ran ${record.results.length}`);
  check("an emergency stop halts the remaining steps", record.results.length < steps.length, String(record.results.length));
  check("a cancelled run is not reported as successful", record.ok === false);

  const after = await executePlan({ ...plan, steps: [{ tool: "system.info", args: {} }] }, "after cancel");
  check("the next run after a stop still executes", after.ok === true && after.cancelled !== true, after.summary);

  const audit = await home.readAudit(300);
  check("the stop is written to the audit log", audit.some((e) => e.action === "plan.cancelled"));

  // Windows cannot remove a directory that is the working directory.
  process.chdir(origin);
}

await rm(temp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
