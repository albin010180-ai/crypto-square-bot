import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRemainingQuota } from "./src/llm.mjs";
import { loadEnv } from "./src/env.mjs";
import { ensureDirs, loadHistory, saveHistory, appendPublished, saveRunLog, saveLatestVideo } from "./src/store.mjs";
import { collectNews, normalizeTitle } from "./src/news.mjs";
import { generateVideoScript, generateInfoVideoScript } from "./src/video-script.mjs";
import { pickInfoTopic } from "./src/info-topics.mjs";
import { uploadVideoAsset, uploadImageAsset, publishVideoPost } from "./src/video-publish.mjs";
import { tweet } from "./src/x.mjs";
import {
  publishShortPostSafe,
  stripRiskyPunct,
  aggressiveStrip,
  isolateHashtags,
  hardCore,
} from "./src/publish.mjs";
import { speak, makeSlides, renderVideo } from "./src/media.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_MODEL = "google/gemma-4-31b-it:free";
const STAGGER_MS = Number.parseInt(process.env.POST_STAGGER_MS ?? "90000", 10) || 90000;

function parseArgs() {
  return {
    dryRun: process.argv.includes("--dry-run"),
    force: process.argv.includes("--force") || process.env.FORCE_PUBLISH === "true",
    info: process.argv.includes("--info") || process.env.VIDEO_MODE === "info",
  };
}

function buildCfg() {
  return {
    openrouterKey: process.env.OPENROUTER_API_KEY?.trim() || "",
    binanceKey: process.env.BINANCE_SQUARE_OPENAPI_KEY?.trim() || "",
    model: process.env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL,
    maxCandidates: Number.parseInt(process.env.MAX_CANDIDATES ?? "8", 10) || 8,
    langs: (process.env.VIDEO_LANGS?.trim() || "tr,en")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    footer: process.env.VIDEO_FOOTER?.trim() || "@Mr_Emanetson | Binance Square",
    referralLink: process.env.X_REFERRAL_LINK?.trim() || "https://me-l.co/b6iygwwa",
    referralCode: process.env.X_REFERRAL_CODE?.trim() || "CPA_001D41FKZ1",
    x: {
      apiKey: process.env.X_API_KEY?.trim() || "",
      apiSecret: process.env.X_API_SECRET?.trim() || "",
      accessToken: process.env.X_ACCESS_TOKEN?.trim() || "",
      accessSecret: process.env.X_ACCESS_SECRET?.trim() || "",
    },
  };
}

const CAPTION_VARIANTS = [
  { name: "hafif", fn: (c) => stripRiskyPunct(c) },
  { name: "agresif", fn: (c) => aggressiveStrip(c) },
  { name: "hashtag-izole", fn: (c) => aggressiveStrip(isolateHashtags(c)) },
  { name: "cekirdek", fn: hardCore },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function limitTweetCashtags(text) {
  const seen = new Set();
  return text.replace(/\$([A-Z][A-Z0-9]{1,9})\b/g, (match, sym) => {
    if (seen.size < 1 || seen.has(sym)) {
      seen.add(sym);
      return match;
    }
    return sym;
  });
}

function ensureCashtagsInShortPost(shortText, caption) {
  const captionCashtags = [...caption.matchAll(/\$([A-Z][A-Z0-9]{1,9})\b/g)].map(m => m[0]);
  const textCashtags = [...shortText.matchAll(/\$([A-Z][A-Z0-9]{1,9})\b/g)].map(m => m[0]);
  if (textCashtags.length >= 2 || captionCashtags.length === 0) return shortText;
  const needed = captionCashtags.filter(ct => !textCashtags.includes(ct)).slice(0, 2);
  if (needed.length === 0) return shortText;
  const hashtags = shortText.match(/#[A-Za-z0-9_]+/g) || [];
  const tagLine = hashtags.join(" ");
  const textWithoutTags = shortText.replace(/#[A-Za-z0-9_]+/g, "").trim();
  return `${textWithoutTags} ${needed.join(" ")} ${tagLine}`.trim();
}

function savePendingTweet(text, lang, postUrl) {
  const file = path.join(__dirname, "data", "pending-tweets.json");
  let tweets = [];
  try { tweets = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  tweets.push({ text, lang, postUrl, createdAt: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify(tweets, null, 2));
  console.log(`  Tweet kaydedildi (pending-tweets.json) - manuel paylasim icin`);
}

async function publishWithRetry(cfg, params) {
  let lastErr;
  let variantIdx = 0;

  for (let attempt = 1; attempt <= 5 && variantIdx < CAPTION_VARIANTS.length; attempt++) {
    try {
      params.caption = CAPTION_VARIANTS[variantIdx].fn(params.caption);
      params.title = stripRiskyPunct(params.title);
      console.log(`  yayin denemesi ${attempt} (caption varyant: ${CAPTION_VARIANTS[variantIdx].name})`);
      console.log(`  CAPTION >>>\n${params.caption}\n<<<`);
      const res = await publishVideoPost(cfg.binanceKey, {
        fileTicket: params.fileTicket,
        cover: params.cover,
        durationSec: params.durationSec,
        caption: params.caption,
      });
      if (attempt > 1 || variantIdx > 0) console.log(`  basarili varyant: ${CAPTION_VARIANTS[variantIdx].name}`);
      return res;
    } catch (err) {
      lastErr = err;
      if (/220094|Hashtag count/i.test(err.message)) {
        console.warn("  hashtag limiti asildi, caption kisaltiliyor...");
        const tags = [...params.caption.matchAll(/#[A-Za-z0-9_]+/g)];
        if (tags.length > 4) {
          const cut = tags[4].index ?? -1;
          if (cut > 0) params.caption = params.caption.slice(0, cut).trim();
          continue;
        }
      }
      if (/220095|Coin pair/i.test(err.message)) {
        console.warn("  cashtag limiti asildi, temizleniyor...");
        params.caption = params.caption.replace(/\$([A-Z][A-Z0-9]{1,9})\b/g, "$1");
        continue;
      }
      if (/20030|punctuation/i.test(err.message)) {
        console.warn("  noktalama reddi -> siradaki caption varyanti deneniyor");
        variantIdx += 1;
        await sleep(1500);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function main() {
  const startedAt = new Date().toISOString();
  const { dryRun, force, info } = parseArgs();
  loadEnv();
  const cfg = buildCfg();
  ensureDirs();

  if (!cfg.openrouterKey) {
    console.error("HATA: OPENROUTER_API_KEY tanimli degil.");
    process.exit(1);
  }
  if (!cfg.binanceKey && !dryRun) {
    console.error("HATA: BINANCE_SQUARE_OPENAPI_KEY tanimli degil.");
    process.exit(1);
  }

  console.log(`[${startedAt}] Video uretimi basladi${dryRun ? " (DRY-RUN)" : ""}${info ? " (BILGILENDIRME MODU)" : ""}`);
  console.log(`Model: ${cfg.model} | Diller: ${cfg.langs.join(", ")}`);

  if (!dryRun && (process.env.PUBLISH_ENABLED ?? "true") === "false") {
    console.log("Yayinler duraklatilmis (PUBLISH_ENABLED=false). Bu tur atlandi.");
    return;
  }

  const quota = getRemainingQuota();
  console.log(`OpenRouter quota: ${quota}/45 kalan`);
  if (quota < 10) {
    console.log(`Quota cok dusuk (${quota}). Video atlandi.`);
    return;
  }

  let script;
  let storyMeta;
  let useInfo = info;

  if (!useInfo) {
    const history = loadHistory();
    const seenLinks = new Set(history.links);
    const seenTitles = new Set(history.titles);

    console.log("Haber kaynaklari taraniyor...");
    const { candidates, totalFetched, errors } = await collectNews({
      maxCandidates: cfg.maxCandidates,
    });
    for (const e of errors) console.warn(`  kaynak hatasi: ${e}`);
    console.log(`${totalFetched} haber okundu, ${candidates.length} aday secildi.`);

    const fresh = force
      ? candidates
      : candidates.filter(
          (c) => !seenLinks.has(c.link) && !seenTitles.has(normalizeTitle(c.title))
        );
    console.log(`Daha once kullanilmamis: ${fresh.length} aday.${force ? " (FORCE)" : ""}`);

    if (fresh.length === 0) {
      console.log("Yeni haber yok -> bilgilendirme videosu uretilecek.");
      useInfo = true;
    } else {
      const candidate = fresh[0];
      console.log(`Secilen haber: ${candidate.title} (${candidate.source})`);
      storyMeta = { type: "news", title: candidate.title, source: candidate.source, link: candidate.link };
      script = await generateVideoScript(candidate, cfg);
      storyMeta.usedLink = candidate.link;
      storyMeta.usedTitleNorm = normalizeTitle(candidate.title);
    }
  }

  if (useInfo && !script) {
    const topic = pickInfoTopic(new Date(), 0);
    console.log(`Bilgilendirme konusu: ${topic.id} - ${topic.tr}`);
    storyMeta = { type: "info", topicId: topic.id };
    script = await generateInfoVideoScript(topic, cfg);
  }

  console.log(`TR: ${script.tr.title}`);
  console.log(`EN: ${script.en.title}\n`);

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "sqvideo-"));
  const record = {
    startedAt,
    finishedAt: null,
    dryRun,
    model: cfg.model,
    contentType: storyMeta.type,
    story: storyMeta,
    script,
    videos: [],
  };

  let firstLang = true;
  for (const lang of cfg.langs) {
    if (!firstLang && !dryRun) {
      console.log(`spam-onleme: sonraki dil icin ${STAGGER_MS / 1000}sn bekleniyor...`);
      await sleep(STAGGER_MS);
    }
    firstLang = false;
    const part = script[lang];
    if (!part) {
      console.warn(`${lang}: senaryo yok, atlandi`);
      continue;
    }
    try {
      const dir = path.join(tmpBase, lang);
      fs.mkdirSync(dir, { recursive: true });

      console.log(`[${lang.toUpperCase()}] ses dosyasi uretiliyor...`);
      const mp3 = path.join(dir, "voice.mp3");
      const ttsEngine = await speak(part.script ?? part.slides.join(". "), lang, mp3);
      if (!ttsEngine) console.warn("  TTS basarisiz, sessiz video uretilecek");

      console.log(`[${lang.toUpperCase()}] slaytlar ciziliyor...`);
      const pngs = await makeSlides([stripRiskyPunct(part.title), ...part.slides.map(stripRiskyPunct)], dir, cfg.footer);

      console.log(`[${lang.toUpperCase()}] video birlestiriliyor...`);
      const mp4 = path.join(dir, "out.mp4");
      const meta = await renderVideo({ pngs, mp3: ttsEngine ? mp3 : null, outMp4: mp4 });
      console.log(
        `  sure: ${meta.total.toFixed(1)}sn | ses: ${ttsEngine ?? "yok"} | boyut: ${(
          fs.statSync(mp4).size / 1024 / 1024
        ).toFixed(1)}MB`
      );

      if (dryRun) {
        record.videos.push({ lang, file: mp4, total: meta.total, tts: ttsEngine });
        continue;
      }

      console.log(`[${lang.toUpperCase()}] Binance'e yukleniyor...`);
      const fileTicket = await uploadVideoAsset(cfg.binanceKey, mp4);
      const cover = await uploadImageAsset(cfg.binanceKey, pngs[0]);

      const res = await publishWithRetry(cfg, {
        fileTicket,
        cover,
        durationSec: Math.round(meta.total),
        caption: part.caption,
        title: part.title,
      });
      console.log(`  OK: ${res.url ?? res.note ?? "(id alinamadi)"}`);

      console.log(`[${lang.toUpperCase()}] kisa post yayinlaniyor...`);
      try {
        const shortText = ensureCashtagsInShortPost(`${part.title}\n\n${part.caption.split("\n").slice(-2).join("\n")}`, part.caption);
        const sp = await publishShortPostSafe(cfg.binanceKey, { text: shortText });
        res.shortPost = sp.result;
        console.log(`  Kisa post OK: ${sp.result.url ?? sp.result.note ?? "(id alinamadi)"}`);
      } catch (err) {
        console.warn(`  Kisa post atlandi: ${err.message}`);
        res.shortPostError = err.message;
      }

      if (res.url) {
        const xEnabled = Object.values(cfg.x).every(Boolean);
        const xText = `${limitTweetCashtags(script.en.title)}\n\nReferral kod: ${cfg.referralCode}`;
        
        if (xEnabled) {
          try {
            const x = await tweet({ ...cfg.x, text: xText });
            console.log(`  X: ${x.url}`);
            res.xUrl = x.url;
          } catch (err) {
            console.warn(`  X hatasi: ${err.message}`);
            res.xError = err.message;
            savePendingTweet(xText, lang, res.url);
          }
        } else {
          savePendingTweet(xText, lang, res.url);
        }
      }

      record.videos.push({ lang, ...res, title: part.title });
    } catch (err) {
      console.error(`  HATA (${lang}): ${err.message}`);
      record.videos.push({ lang, error: err.message });
    }
  }

  if (storyMeta.type === "news") {
    const history = loadHistory();
    history.links.push(storyMeta.usedLink);
    history.titles.push(storyMeta.usedTitleNorm);
    saveHistory(history);
  }

  const success = record.videos.filter((v) => !v.error).length;
  appendPublished(
    record.videos
      .filter((v) => !v.error && v.url)
      .map((v) => ({
        type: "video",
        contentType: storyMeta.type,
        lang: v.lang,
        id: v.id,
        url: v.url,
        title: v.title,
        at: new Date().toISOString(),
      }))
  );

  record.finishedAt = new Date().toISOString();
  saveLatestVideo(record);
  console.log(`\nLog: ${saveRunLog(record)}`);
  console.log(`Ozet: ${success}/${record.videos.length} video islendi.`);

  fs.rmSync(tmpBase, { recursive: true, force: true });

  if (!dryRun && success === 0) process.exit(1);
}

main().catch((err) => {
  console.error(`OLUSMAYAN HATA: ${err.stack || err.message}`);
  process.exit(1);
});
