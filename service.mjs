import { loadEnv } from "./src/env.mjs";
import { ensureDirs } from "./src/store.mjs";

// Load env first
loadEnv();
ensureDirs();

const INTERVALS = {
  trending: 5 * 60 * 1000,   // 5 dakika
  publish: 4 * 60 * 60 * 1000, // 4 saat
  video: 4 * 60 * 60 * 1000,   // 4 saat
};

const STAGGER = {
  publish: 0,
  video: 30 * 60 * 1000, // 30 dk once video
};

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function runScript(name, scriptPath, args = []) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  try {
    log(`Starting ${name}...`);
    const { stdout, stderr } = await execFileAsync("node", [scriptPath, ...args], {
      timeout: 10 * 60 * 1000, // 10 dk max
      cwd: new URL(".", import.meta.url).pathname,
      env: process.env,
    });
    if (stdout) log(`[${name}] ${stdout.slice(-500)}`);
    if (stderr) log(`[${name}] stderr: ${stderr.slice(-300)}`);
    log(`${name} completed`);
  } catch (err) {
    log(`${name} FAILED: ${err.message}`);
  }
}

function scheduleNext(name, scriptPath, intervalMs, args = [], offsetMs = 0) {
  const run = () => {
    runScript(name, scriptPath, args);
    scheduleNext(name, scriptPath, intervalMs, args, 0);
  };

  if (offsetMs > 0) {
    const delay = Math.max(0, offsetMs - Date.now() % intervalMs);
    log(`Next ${name} in ${Math.round(delay / 1000)}s`);
    setTimeout(run, delay);
  } else {
    log(`Next ${name} in ${Math.round(intervalMs / 1000)}s`);
    setTimeout(run, intervalMs);
  }
}

// ── Main ──
log("=== Crypto Square Bot Service ===");
log("Trending: every 5min | Publish: every 4h | Video: every 4h+30min");

// Trending — her 5 dakika
scheduleNext("trending", "trending.mjs", INTERVALS.trending, ["--once"]);

// Publish — her 4 saat
scheduleNext("publish", "run.mjs", INTERVALS.publish, [], STAGGER.publish);

// Video — her 4 saat (publish'den 30 dk once)
scheduleNext("video", "video.mjs", INTERVALS.video, [], STAGGER.video);

// Health check — her 10 dk
setInterval(() => {
  log(`Health: uptime=${Math.round(process.uptime())}s mem=${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`);
}, 10 * 60 * 1000);

log("Service started. Waiting for first run...");
