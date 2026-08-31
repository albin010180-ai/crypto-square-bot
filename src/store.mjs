import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";

const DATA_DIR = path.join(ROOT, "data");
const LOGS_DIR = path.join(ROOT, "logs");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const PUBLISHED_FILE = path.join(DATA_DIR, "published.json");
const LATEST_FILE = path.join(DATA_DIR, "latest.json");
const BINANCE_BLOCKED_FILE = path.join(DATA_DIR, "binance-blocked.json");

export function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function loadHistory() {
  return readJson(HISTORY_FILE, { links: [], titles: [] });
}

export function saveHistory(history) {
  history.links = [...new Set(history.links)].slice(-5000);
  history.titles = [...new Set(history.titles)].slice(-5000);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), "utf8");
}

export function appendPublished(entries) {
  if (entries.length === 0) return;
  const current = readJson(PUBLISHED_FILE, []);
  current.push(...entries);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PUBLISHED_FILE, JSON.stringify(current.slice(-2000), null, 2), "utf8");
}

export function saveLatest(record) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LATEST_FILE, JSON.stringify(record, null, 2), "utf8");
}

const LATEST_VIDEO_FILE = path.join(DATA_DIR, "latest-video.json");

export function saveLatestVideo(record) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LATEST_VIDEO_FILE, JSON.stringify(record, null, 2), "utf8");
}

export function getTodayPostCount() {
  const entries = readJson(PUBLISHED_FILE, []);
  const today = new Date().toISOString().split("T")[0];
  return entries.filter((e) => {
    const at = e.at || e.publishedAt || "";
    return at.startsWith(today);
  }).length;
}

export function canPublishToday(maxPosts = 80) {
  const count = getTodayPostCount();
  if (count >= maxPosts) {
    console.warn(`[STORE] Gunluk post limiti: ${count}/${maxPosts}`);
    return false;
  }
  // Binance 220009 flag kontrolu
  try {
    const data = JSON.parse(fs.readFileSync(BINANCE_BLOCKED_FILE, "utf8"));
    if (data.blockedUntil && Date.now() < data.blockedUntil) {
      const waitH = Math.round((data.blockedUntil - Date.now()) / 3600000);
      console.warn(`[STORE] Binance post engeli: ${waitH} saat kalan`);
      return false;
    }
  } catch {}
  return true;
}

export function markBinanceBlocked() {
  const data = { blockedUntil: Date.now() + 12 * 3600000, at: new Date().toISOString() };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(BINANCE_BLOCKED_FILE, JSON.stringify(data, null, 2));
  console.warn(`[STORE] Binance 220009: 12 saat post engellendi`);
}

export function saveRunLog(record) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(LOGS_DIR, `run-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2), "utf8");
  return file;
}
