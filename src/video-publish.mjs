import fs from "node:fs";
import path from "node:path";

const BASE_URL_V1 = "https://www.binance.com/bapi/composite/v1/public/pgc/openApi";
const BASE_URL_V2 = "https://www.binance.com/bapi/composite/v2/public/pgc/openApi";
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_RETRIES = 20;

async function api(endpoint, apiKey, body, baseUrl = BASE_URL_V2) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "X-Square-OpenAPI-Key": apiKey,
        "Content-Type": "application/json",
        clienttype: "binanceSkill",
      },
      body: JSON.stringify(body),
    });

    if (endpoint === "/content/add" && res.status === 504) {
      return { id: null, shareLink: null, publishStatus: "success_without_post_id" };
    }

    const raw = await res.text();
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error(`Binance gecersiz yanit (HTTP ${res.status}): ${raw.slice(0, 200)}`);
    }
    if (json.code !== "000000") {
      throw new Error(`Binance API hatasi [${json.code}]: ${json.message}`);
    }
    return json.data;
  } finally {
    clearTimeout(timer);
  }
}

async function uploadToS3(presignedUrl, filePath, contentType) {
  const buffer = fs.readFileSync(filePath);
  const res = await fetch(presignedUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: buffer,
  });
  if (!res.ok) throw new Error(`S3 yukleme basarisiz: ${res.status}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function pollProcessing(apiKey, fileTicket) {
  for (let i = 0; i < MAX_POLL_RETRIES; i++) {
    const data = await api("/image/imageStatus", apiKey, { fileTicket });
    if (data.status === 1) return data;
    if (data.status === 2) throw new Error(`Isleme basarisiz: ${data.failedReason}`);
    console.log(`  Isleme devam ediyor... (${i + 1}/${MAX_POLL_RETRIES})`);
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error("Isleme zaman asimi");
}

export async function uploadVideoAsset(apiKey, filePath) {
  const fileName = path.basename(filePath);
  const size = fs.statSync(filePath).size;
  console.log(`Video yukleniyor: ${fileName} (${(size / 1024 / 1024).toFixed(1)}MB)`);
  const { presignedUrl, fileTicket } = await api("/video/preSign", apiKey, {
    fileName,
    size,
  });
  await uploadToS3(presignedUrl, filePath, "video/mp4");
  console.log("  S3'e yuklendi, isleme durumu bekleniyor...");
  await pollProcessing(apiKey, fileTicket);
  return fileTicket;
}

export async function uploadImageAsset(apiKey, filePath) {
  const imageName = path.basename(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const contentType = ext === "png" ? "image/png" : "image/jpeg";
  const { presignedUrl, fileTicket } = await api("/image/presignedUrl", apiKey, {
    imageName,
  });
  await uploadToS3(presignedUrl, filePath, contentType);
  const status = await pollProcessing(apiKey, fileTicket);
  return status.imageUrl;
}

export async function publishVideoPost(apiKey, { fileTicket, cover, durationSec, caption }) {
  const body = {
    contentType: 3,
    fileTicket,
    cover,
    videoTimeSeconds: Math.max(1, Math.round(durationSec)),
    isPublish: true,
    bodyTextOnly: caption.slice(0, 1500),
  };
  const data = await api("/content/add", apiKey, body, BASE_URL_V1);
  const id = data?.id ?? null;
  return {
    id,
    url: id ? `https://www.binance.com/square/post/${id}` : null,
    note: id ? null : "504 - gonderildi ancak post ID alinamadi",
  };
}
