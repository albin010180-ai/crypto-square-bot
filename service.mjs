import { loadEnv } from "./src/env.mjs";
import { ensureDirs } from "./src/store.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import http from "node:http";

const execFileAsync = promisify(execFile);
const ROOT = new URL(".", import.meta.url).pathname;

// ── Env ──
loadEnv();
ensureDirs();

// ── Config ──
const INTERVALS = {
  trending: 5 * 60 * 1000,
  publish: 4 * 60 * 60 * 1000,
  video: 4 * 60 * 60 * 1000,
};

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ── Git Sync ──
async function gitPull() {
  try {
    await execFileAsync("git", ["pull", "--rebase"], { cwd: ROOT, timeout: 30000 });
    log("Git pull OK");
  } catch (e) {
    log("Git pull skip: " + e.message.slice(0, 100));
  }
}

async function gitCommitPush(msg) {
  try {
    await execFileAsync("git", ["add", "data/"], { cwd: ROOT, timeout: 10000 });
    const { stdout } = await execFileAsync("git", ["diff", "--cached", "--quiet"], { cwd: ROOT }).catch(() => ({ stdout: "dirty" }));
    if (stdout === "") {
      log("No data changes to commit");
      return;
    }
    await execFileAsync("git", ["commit", "-m", msg], { cwd: ROOT, timeout: 10000 });
    await execFileAsync("git", ["push"], { cwd: ROOT, timeout: 30000 });
    log("Git push OK: " + msg);
  } catch (e) {
    log("Git push skip: " + e.message.slice(0, 100));
  }
}

// ── Script Runner ──
async function runScript(name, scriptPath, args = []) {
  await gitPull();
  log(`Starting ${name}...`);
  try {
    const { stdout, stderr } = await execFileAsync("node", [scriptPath, ...args], {
      timeout: 10 * 60 * 1000,
      cwd: ROOT,
      env: process.env,
    });
    if (stdout) {
      const lines = stdout.split("\n").filter(Boolean);
      log(`[${name}] ${lines.slice(-8).join(" | ")}`);
    }
    if (stderr && !stderr.includes("Warning")) {
      log(`[${name}] stderr: ${stderr.slice(-200)}`);
    }
    log(`${name} completed`);
  } catch (err) {
    log(`${name} FAILED: ${err.message.slice(0, 200)}`);
  }
  await gitCommitPush(`bot: ${name} state [skip ci]`);
}

// ── Scheduler ──
const running = new Map();

function schedulePeriodic(name, scriptPath, intervalMs, args = []) {
  const run = async () => {
    if (running.get(name)) {
      log(`${name} still running, skipping`);
      return;
    }
    running.set(name, true);
    try {
      await runScript(name, scriptPath, args);
    } finally {
      running.set(name, false);
    }
    setTimeout(run, intervalMs);
  };
  // First run after small delay
  setTimeout(run, 5000);
}

// ── Health Check Server ──
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      uptime: Math.round(process.uptime()),
      memory: Math.round(process.memoryUsage().rss / 1024 / 1024),
      timestamp: new Date().toISOString(),
    }));
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});
server.listen(PORT, () => log(`Health check: http://localhost:${PORT}/health`));

// ── Start ──
log("=== Crypto Square Bot Service ===");
log(`Trending: ${INTERVALS.trending / 1000}s | Publish: ${INTERVALS.publish / 3600000}h | Video: ${INTERVALS.video / 3600000}h`);

schedulePeriodic("trending", "trending.mjs", INTERVALS.trending, ["--once"]);
schedulePeriodic("publish", "run.mjs", INTERVALS.publish);
schedulePeriodic("video", "video.mjs", INTERVALS.video);

log("Service started.");
