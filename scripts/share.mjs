// Public share link: serves the production build and exposes it through a
// Cloudflare quick tunnel (https://<random>.trycloudflare.com).
// Usage: npm run share
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const PORT = 3000;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const dataDir = path.resolve(".data");
const bin = path.join(dataDir, process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
const TUNNEL_URL =
  process.platform === "win32"
    ? "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
    : process.platform === "darwin"
      ? "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz"
      : "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64";

let server;
let tunnel;

function shutdown(code = 0) {
  for (const child of [tunnel, server]) {
    if (child && !child.killed) child.kill();
  }
  process.exit(code);
}

async function isUp() {
  try {
    const res = await fetch(ORIGIN);
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await isUp()) {
    console.log(`· using the server already running on ${ORIGIN}`);
    return;
  }
  if (!existsSync(".next/BUILD_ID")) {
    console.log("· no production build found — run `npm run build` first.");
    process.exit(1);
  }
  server = spawn("npx", ["next", "start", "-p", String(PORT)], { stdio: "inherit", shell: true });
  for (let i = 0; i < 60; i++) {
    if (await isUp()) {
      console.log(`· server ready on ${ORIGIN}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error("· server did not become ready on " + ORIGIN);
  shutdown(1);
}

async function ensureCloudflared() {
  if (existsSync(bin)) return;
  await mkdir(dataDir, { recursive: true });
  console.log("· downloading cloudflared…");
  const res = await fetch(TUNNEL_URL);
  if (!res.ok) {
    console.error(`· cloudflared download failed (${res.status})`);
    process.exit(1);
  }
  const { writeFile } = await import("node:fs/promises");
  await writeFile(bin, Buffer.from(await res.arrayBuffer()), { mode: 0o755 });
}

async function main() {
  await ensureServer();
  await ensureCloudflared();

  tunnel = spawn(bin, ["tunnel", "--url", ORIGIN, "--no-autoupdate"], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  let printed = false;
  const scan = (chunk) => {
    const match = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match && !printed) {
      printed = true;
      console.log("\n  Public link:  " + match[0] + "\n");
      console.log("  Keep this window open — the link is live only while it runs.\n");
    }
  };
  tunnel.stdout.on("data", scan);
  tunnel.stderr.on("data", scan);
  tunnel.on("exit", (code) => {
    console.error("· tunnel stopped");
    shutdown(code ?? 1);
  });

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
}

main();
