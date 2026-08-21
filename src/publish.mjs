const PUBLISH_URL =
  "https://www.binance.com/bapi/composite/v1/public/pgc/openApi/content/add";

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
