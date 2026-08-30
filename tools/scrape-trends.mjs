#!/usr/bin/env node
// Scrape Binance Square trending topics page using Playwright
// Output: JSON array of clean topic strings to stdout
import { chromium } from "playwright";

const TRENDS_URL = "https://www.binance.com/en/square/trends";

function cleanTopic(text) {
  return text
    .replace(/^\d+\s*/, "")           // leading numbers "1 ", "2 "
    .replace(/^#\s*/, "")             // leading "# "
    .replace(/\d+\s*views?\s*/gi, "") // "2630 views"
    .replace(/\d+\s*Discussing\s*/gi, "") // "233 Discussing"
    .replace(/\d+\s*comments?\s*/gi, "") // "122 comments"
    // Split camelCase and consecutive uppercase: "ICBAOpposes" -> "ICBA Opposes"
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    // Split acronym followed by word: "CLARITYAct" -> "CLARITY Act"
    .replace(/([A-Z]{2,})([A-Z][a-z])/g, "$1 $2")
    // Split letter/number边界: "ETFs2026" -> "ETFs 2026"
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zA-Z])/g, "$1 $2")
    // Split % followed by uppercase: "3.24%This" -> "3.24% This"
    .replace(/(%)([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function isValidTopic(text) {
  if (!text || text.length < 3 || text.length > 80) return false;
  // Must start with a letter
  if (!/^[A-Za-z]/.test(text)) return false;
  // Reject pure numbers or numbers+noise
  if (/^\d+\s*$/.test(text)) return false;
  // Reject common non-topic strings
  const reject = /^(discussing|views|comments|trending|hot|popular|share|save|follow|login|sign up|join|home|explore|feed|search)$/i;
  if (reject.test(text)) return false;
  return true;
}

async function scrape() {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
      ],
    });
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
      locale: "en-US",
      timezoneId: "America/New_York",
    });
    const page = await ctx.newPage();

    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      delete navigator.__proto__.webdriver;
      window.chrome = { runtime: {} };
    });

    // Navigate and wait for WAF challenge to resolve
    let loaded = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      process.stderr.write("Attempt " + attempt + "...\n");
      await page.goto(TRENDS_URL, {
        waitUntil: "domcontentloaded",
        timeout: 25000,
      });
      await page.waitForTimeout(10000);

      const title = await page.title();
      process.stderr.write("Title: " + title + "\n");

      if (!title.includes("ERROR") && !title.includes("challenge") && !title.includes("Just a moment")) {
        loaded = true;
        break;
      }
      await page.waitForTimeout(5000);
    }

    if (!loaded) {
      process.stderr.write("WAF blocked after retries\n");
      process.stdout.write("[]");
      return;
    }

    await page.waitForTimeout(5000);

    // Extract trending topics - try structured selectors first
    const topics = await page.evaluate(() => {
      const results = [];
      const selectors = [
        'a[href*="/square/hashtag/"]',
        'a[href*="/square/trends/"]',
        'a[href*="/en/feed/topic/"]',
        'a[href*="/en/feed/hashtag/"]',
        '[class*="trendItem"] a',
        '[class*="trend-item"] a',
        '[class*="topicItem"] a',
        '[class*="topic-item"] a',
        '[data-testid*="trend"] a',
        '[data-testid*="topic"] a',
      ];
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach((el) => {
          // Use innerText to preserve spaces between elements
          const text = (el.innerText || el.textContent || "").trim();
          if (text && text.length > 2 && text.length < 80) {
            results.push(text.replace(/^#/, "").trim());
          }
        });
      }
      return [...new Set(results)];
    });

    if (topics.length > 0) {
      const cleaned = topics.map(cleanTopic).filter(isValidTopic);
      process.stderr.write("Found " + cleaned.length + " clean topics\n");
      process.stdout.write(JSON.stringify(cleaned));
      return;
    }

    // Fallback: extract from page body with strict filtering
    const fallback = await page.evaluate(() => {
      const results = [];
      // Get all links
      document.querySelectorAll("a").forEach((a) => {
        const href = a.getAttribute("href") || "";
        const text = a.textContent?.trim();
        if (
          text &&
          text.length > 3 &&
          text.length < 60 &&
          /^[A-Z]/.test(text) &&
          (href.includes("hashtag") || href.includes("trend") || href.includes("topic"))
        ) {
          results.push(text.replace(/^#/, "").trim());
        }
      });
      return [...new Set(results)].slice(0, 20);
    });

    const cleaned = fallback.map(cleanTopic).filter(isValidTopic);
    process.stderr.write("Fallback found " + cleaned.length + " clean topics\n");
    process.stdout.write(JSON.stringify(cleaned));
  } catch (err) {
    process.stderr.write("Error: " + err.message + "\n");
    process.stdout.write("[]");
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

scrape();
