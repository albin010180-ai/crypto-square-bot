import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";

const DATA_DIR = path.join(ROOT, "data");
const LOGS_DIR = path.join(ROOT, "logs");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const PUBLISHED_FILE = path.join(DATA_DIR, "published.json");
const LATEST_FILE = path.join(DATA_DIR, "latest.json");

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

export function saveRunLog(record) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(LOGS_DIR, `run-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2), "utf8");
  return file;
}
