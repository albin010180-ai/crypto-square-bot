import crypto from "node:crypto";

function percentEncode(str) {
  return encodeURIComponent(String(str)).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

export async function tweet({ apiKey, apiSecret, accessToken, accessSecret, text }) {
  const url = "https://api.twitter.com/2/tweets";
  const oauth = {
    oauth_consumer_key: apiKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: "1.0",
  };

  const params = { ...oauth, text };
  const baseParams = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join("&");
  const baseString = ["POST", percentEncode(url), percentEncode(baseParams)].join("&");
  const signingKey = `${percentEncode(apiSecret)}&${percentEncode(accessSecret)}`;
  oauth.oauth_signature = crypto
    .createHmac("sha1", signingKey)
    .update(baseString)
    .digest("base64");

  const header =
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(oauth[k])}"`)
      .join(", ");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: header, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const raw = await res.text();
    let json = null;
    try {
      json = JSON.parse(raw);
    } catch {}
    if (!res.ok || !json?.data?.id) {
      throw new Error(`X API HTTP ${res.status}: ${raw.slice(0, 250)}`);
    }
    return { id: json.data.id, url: `https://x.com/i/web/status/${json.data.id}` };
  } finally {
    clearTimeout(timer);
  }
}
