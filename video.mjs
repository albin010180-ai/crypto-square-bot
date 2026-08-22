import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnv } from "./src/env.mjs";
import { ensureDirs, loadHistory, saveHistory, appendPublished, saveRunLog, saveLatestVideo } from "./src/store.mjs";
import { collectNews, normalizeTitle } from "./src/news.mjs";
import { generateVideoScript, generateInfoVideoScript } from "./src/video-script.mjs";
import { pickInfoTopic } from "./src/info-topics.mjs";
import { uploadVideoAsset, uploadImageAsset, publishVideoPost } from "./src/video-publish.mjs";
import { publishShortPost } from "./src/publish.mjs";
import { speak, makeSlides, renderVideo } from "./src/media.mjs";

const DEFAULT_MODEL = "google/gemma-4-31b-it:free";

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
  };
}

// [20030] "topic cannot contain punctuation" hatasina karsi temizlik
function stripRiskyPunct(s) {
  return String(s)
    .replace(/["""''`:;()\[\]{}<>|\\\/~^*_+=@]/g, " ")
    .replace(/\$(?=\d)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function aggressiveStrip(s) {
  return String(s)
    .replace(/[^\p{L}\p{N}\s#$.!?,%-]/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function publishWithRetry(cfg, params) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      params.caption = stripRiskyPunct(params.caption);
      params.title = stripRiskyPunct(params.title);
      return await publishVideoPost(cfg.binanceKey, {
        fileTicket: params.fileTicket,
        cover: params.cover,
        durationSec: params.durationSec,
        caption: params.caption,
      });
    } catch (err) {
      lastErr = err;
      if (/220094|Hashtag count/i.test(err.message)) {
        console.warn("  hashtag limiti asildi, caption temizleniyor...");
        const tags = [...params.caption.matchAll(/#[A-Za-z0-9_]+/g)];
        if (tags.length > 4) {
          const cut = tags[4].index ?? -1;
          if (cut > 0) params.caption = params.caption.slice(0, cut).trim();
          continue;
        }
      }
      if (/220095|Coin pair/i.test(err.message)) {
        console.warn("  cashtag limiti asildi, caption temizleniyor...");
        params.caption = params.caption.replace(/\$([A-Z][A-Z0-9]{1,9})\b/g, "$1");
        continue;
      }
      if (/20030|punctuation/i.test(err.message)) {
        console.warn("  noktalama reddi, agresif temizlik yapiliyor...");
        params.caption = aggressiveStrip(params.caption);
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

  for (const lang of cfg.langs) {
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
        const shortText = `${part.title}\n\n${part.caption.split("\n").slice(-2).join("\n")}`;
        res.shortPost = await publishShortPost(cfg.binanceKey, { text: shortText.slice(0, 500) });
        console.log(`  Kisa post OK: ${res.shortPost.url ?? res.shortPost.note ?? "(id alinamadi)"}`);
      } catch (err) {
        console.warn(`  Kisa post atlandi: ${err.message}`);
        res.shortPostError = err.message;
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
