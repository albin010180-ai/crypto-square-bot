import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const VOICES = {
  en: "en-US-ChristopherNeural",
};

async function fileNonEmpty(file) {
  try {
    return fs.statSync(file).size > 1000;
  } catch {
    return false;
  }
}

export async function speak(text, lang, outFile) {
  const voice = VOICES[lang] || VOICES.en;
  try {
    await run("python3", [
      "-m", "edge_tts",
      "--voice", voice,
      "--text", text,
      "--write-media", outFile,
    ]);
    if (await fileNonEmpty(outFile)) return "edge-tts";
  } catch (err) {
    console.warn(`  edge-tts basarisiz: ${err.message?.slice(0, 120)}`);
  }

  try {
    await run("python3", [
      "-c",
      `from gtts import gTTS; gTTS(${JSON.stringify(text)}, lang='en').save(r'${outFile}')`,
    ]);
    if (await fileNonEmpty(outFile)) return "gtts";
  } catch (err) {
    console.warn(`  gtts basarisiz: ${err.message?.slice(0, 120)}`);
  }

  return null;
}

export async function ffprobeDuration(file) {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const dur = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(dur)) throw new Error("sure okunamadi");
  return dur;
}

export async function makeSlides(lines, outDir, footer) {
  fs.mkdirSync(outDir, { recursive: true });
  const specFile = path.join(outDir, "spec.json");
  fs.writeFileSync(
    specFile,
    JSON.stringify({ lines, footer }, null, 2),
    "utf8"
  );
  const script = path.join(ROOT, "tools", "make_slides.py");
  const { stdout } = await run("python3", [script, specFile, outDir], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout.trim().split("\n").pop());
}

export async function renderVideo({ pngs, mp3, outMp4, minDuration = 18 }) {
  const n = pngs.length;
  const F = 0.6;

  let audioDur = 0;
  let hasAudio = false;
  if (mp3 && fs.existsSync(mp3)) {
    try {
      audioDur = await ffprobeDuration(mp3);
      hasAudio = true;
    } catch {
      hasAudio = false;
    }
  }
  const target = Math.max(audioDur + 0.9, minDuration, n * 2.2);
  const D = (target + (n - 1) * F) / n;

  const args = [];
  for (const png of pngs) {
    args.push("-loop", "1", "-t", D.toFixed(3), "-i", png);
  }
  if (hasAudio) args.push("-i", mp3);

  const filters = [];
  for (let i = 0; i < n; i++) {
    filters.push(`[${i}:v]scale=1080:1920,setsar=1,fps=30,format=yuv420p[v${i}]`);
  }
  let prev = "v0";
  for (let k = 1; k < n; k++) {
    const out = `x${k}`;
    filters.push(
      `[${prev}][v${k}]xfade=transition=fade:duration=${F}:offset=${(k * (D - F)).toFixed(3)}[${out}]`
    );
    prev = out;
  }
  if (hasAudio) filters.push(`[${n}:a]apad[a]`);

  args.push("-filter_complex", filters.join(";"));
  args.push("-map", `[${prev}]`);
  if (hasAudio) args.push("-map", "[a]");

  args.push(
    "-t", target.toFixed(3),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-r", "30",
    "-movflags", "+faststart"
  );
  if (hasAudio) args.push("-c:a", "aac", "-b:a", "128k");

  args.push("-y", outMp4);
  await run("ffmpeg", args, { maxBuffer: 10 * 1024 * 1024 });
  return { total: target, hasAudio };
}
