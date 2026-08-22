const PUBLISH_URL =
  "https://www.binance.com/bapi/composite/v1/public/pgc/openApi/content/add";

// [20030] "topic cannot contain punctuation" icin temizleyiciler
export function stripRiskyPunct(s) {
  return String(s)
    .replace(/["""''`:;()\[\]{}<>|\\\/~^*_+=@]/g, " ")
    .replace(/\$(?=\d)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function aggressiveStrip(s) {
  return String(s)
    .replace(/[^\p{L}\p{N}\s#$.!?,%-]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function isolateHashtags(s) {
  const tags = [...String(s).matchAll(/#[A-Za-z0-9_]+/g)].map((m) => m[0]).slice(0, 3);
  const body = String(s)
    .replace(/#[A-Za-z0-9_]+/g, " ")
    .replace(/(\d)\s*%/g, "$1")
    .replace(/\$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return tags.length >= 3 ? `${body}\n${tags.join(" ")}` : body;
}

export function hardCore(s) {
  const tags = [...String(s).matchAll(/#[A-Za-z0-9_]+/g)].map((m) => m[0]).slice(0, 3);
  const body = String(s)
    .replace(/#[A-Za-z0-9_]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return tags.length >= 3 ? `${body}\n${tags.join(" ")}` : body;
}

const SANITIZERS = [stripRiskyPunct, aggressiveStrip, isolateHashtags, hardCore];

export function sanitizeSquare(text, { startAt = 0 } = {}) {
  let out = String(text);
  for (let i = startAt; i < SANITIZERS.length; i++) {
    out = SANITIZERS[i](out);
  }
  return out;
}

export async function publishArticle(apiKey, { title, body }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(PUBLISH_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "X-Square-OpenAPI-Key": apiKey,
        "Content-Type": "application/json",
        clienttype: "binanceSkill",
      },
      body: JSON.stringify({
        contentType: 2,
        title,
        bodyTextOnly: body,
      }),
    });

    if (res.status === 504) {
      return { id: null, url: null, note: "504 - gonderildi ancak post ID alinamadi" };
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
    const id = json.data?.id ?? null;
    return { id, url: id ? `https://www.binance.com/square/post/${id}` : null };
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Kisa post (contentType 1)
export async function publishShortPost(apiKey, { text }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(PUBLISH_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "X-Square-OpenAPI-Key": apiKey,
        "Content-Type": "application/json",
        clienttype: "binanceSkill",
      },
      body: JSON.stringify({
        contentType: 1,
        bodyTextOnly: String(text).slice(0, 500),
      }),
    });

    if (res.status === 504) {
      return { id: null, url: null, note: "504 - gonderildi ancak post ID alinamadi" };
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
    const id = json.data?.id ?? null;
    return { id, url: id ? `https://www.binance.com/square/post/${id}` : null };
  } finally {
    clearTimeout(timer);
  }
}

// Kisa post + [20030] kademeli temizlik. Donus: {result, sanitized:boolean}
export async function publishShortPostSafe(apiKey, { text }) {
  let lastErr;
  for (let i = 0; i < SANITIZERS.length; i++) {
    try {
      const clean = SANITIZERS[i](text).slice(0, 500);
      console.log(`kisa post denemesi ${i + 1} (temizlik: ${SANITIZERS[i].name})`);
      if (/20030|punctuation/i.test(lastErr?.message ?? "")) {
        console.log(`TEXT >>>\n${clean}\n<<<`);
      }
      const result = await publishShortPost(apiKey, { text: clean });
      return { result, sanitized: i > 0 };
    } catch (err) {
      lastErr = err;
      if (!/20030|punctuation/i.test(err.message)) throw err;
      await sleep(1200);
    }
  }
  throw lastErr;
}
