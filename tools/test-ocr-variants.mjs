/**
 * A/B test OCR variants on saved Siriu color crops (posts 48–60).
 *
 *   node tools/test-ocr-variants.mjs
 *
 * Tests:
 *   3 — Otsu binarization + nearest-neighbor upscale (no blur)
 *   4 — PSM 7 and PSM 8 (vs baseline PSM 6)
 *   5 — longest digit-run parse (vs last run)
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadImage, createCanvas } from "@napi-rs/canvas";
import { ensureNodeCanvasPolyfills } from "../parser/node-canvas-setup.js";

const CROP_DIR = "./debug-siriu-ocr-crops";
const MIN_OCR_DIM = 120;
const TARGETS = [48, 49, 50, 51, 52, 53, 54, 57, 58, 59, 60];

/** @param {Uint8ClampedArray} data RGBA */
function grayscaleHistogram(data) {
  const hist = new Uint32Array(256);
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const g = Math.round(
      0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2],
    );
    hist[g]++;
  }
  return { hist, n };
}

/** Otsu threshold on grayscale histogram. */
function otsuThreshold(hist, n) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) ** 2;
    if (varBetween > maxVar) {
      maxVar = varBetween;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * @param {import('@napi-rs/canvas').Image} img
 * @param {'fixed110'|'otsu'} mode
 */
async function binarizeImage(img, mode) {
  const w = img.width;
  const h = img.height;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const cropImg = ctx.getImageData(0, 0, w, h);
  const cd = cropImg.data;
  let thresh = 110;
  if (mode === "otsu") {
    const { hist, n } = grayscaleHistogram(cd);
    thresh = otsuThreshold(hist, n);
  }
  for (let i = 0; i < cd.length; i += 4) {
    const lum =
      0.299 * cd[i] + 0.587 * cd[i + 1] + 0.114 * cd[i + 2];
    const dark = mode === "fixed110"
      ? cd[i] < 110 && cd[i + 1] < 110 && cd[i + 2] < 110
      : lum < thresh;
    const v = dark ? 0 : 255;
    cd[i] = cd[i + 1] = cd[i + 2] = v;
    cd[i + 3] = 255;
  }
  ctx.putImageData(cropImg, 0, 0);
  return { canvas, thresh };
}

/**
 * @param {import('@napi-rs/canvas').Canvas} canvas
 * @param {'bilinear'|'nearest'} upscaleMode
 */
async function upscaleCanvas(canvas, upscaleMode) {
  const cropW = canvas.width;
  const cropH = canvas.height;
  if (cropW >= MIN_OCR_DIM && cropH >= MIN_OCR_DIM) return canvas;
  const scaleUp = Math.max(MIN_OCR_DIM / cropW, MIN_OCR_DIM / cropH);
  const upW = Math.round(cropW * scaleUp);
  const upH = Math.round(cropH * scaleUp);
  const up = createCanvas(upW, upH);
  const upCtx = up.getContext("2d");
  upCtx.imageSmoothingEnabled = upscaleMode === "bilinear";
  if (upscaleMode === "nearest") {
    upCtx.imageSmoothingEnabled = false;
  } else {
    upCtx.imageSmoothingQuality = "high";
  }
  upCtx.drawImage(canvas, 0, 0, upW, upH);
  return up;
}

/** @param {string} text @param {'last'|'longest'} mode */
function parseDigitRuns(text, mode) {
  const runs = text.match(/\d{1,3}/g);
  if (!runs?.length) return null;
  if (mode === "longest") {
    const best = runs.reduce((a, b) => (b.length > a.length ? b : a));
    return parseInt(best, 10);
  }
  return parseInt(runs[runs.length - 1], 10);
}

async function createWorkerWithPsm(psm) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, { logger: () => {} });
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: String(psm),
  });
  return worker;
}

await ensureNodeCanvasPolyfills();

const colorFiles = readdirSync(CROP_DIR)
  .filter((f) => f.match(/^idx\d{3}_p\d+_ocr_color\.png$/))
  .map((f) => {
    const m = f.match(/^idx(\d+)_/);
    return { file: f, idx: parseInt(m[1], 10) };
  })
  .filter((x) => x.idx >= 45 && x.idx <= 65)
  .sort((a, b) => a.idx - b.idx);

const variants = [
  { name: "baseline (fixed110+bilinear+psm6+last)", bin: "fixed110", upscale: "bilinear", psm: 6, parse: "last" },
  { name: "3a otsu+bilinear+psm6+last", bin: "otsu", upscale: "bilinear", psm: 6, parse: "last" },
  { name: "3b otsu+nearest+psm6+last", bin: "otsu", upscale: "nearest", psm: 6, parse: "last" },
  { name: "3c otsu+nearest+psm6+longest", bin: "otsu", upscale: "nearest", psm: 6, parse: "longest" },
  { name: "4a otsu+nearest+psm7+longest", bin: "otsu", upscale: "nearest", psm: 7, parse: "longest" },
  { name: "4b otsu+nearest+psm8+longest", bin: "otsu", upscale: "nearest", psm: 8, parse: "longest" },
  { name: "5  otsu+nearest+psm6+longest", bin: "otsu", upscale: "nearest", psm: 6, parse: "longest" },
  { name: "3+4+5 combined", bin: "otsu", upscale: "nearest", psm: 7, parse: "longest" },
];

const workers = new Map();
async function getWorker(psm) {
  if (!workers.has(psm)) workers.set(psm, await createWorkerWithPsm(psm));
  return workers.get(psm);
}

const scores = Object.fromEntries(
  variants.map((v) => [v.name, { ok: 0, total: 0 }]),
);

console.log("Siriu OCR variant test on saved color crops\n");
console.log(
  "idx | expect | baseline | " + variants.slice(1).map((v) => v.name.split(" ")[0]).join(" | "),
);
console.log("----|--------|----------|" + variants.slice(1).map(() => "--------").join("|"));

for (const { file, idx } of colorFiles) {
  if (!TARGETS.includes(idx)) continue;
  const expect = idx;
  const img = await loadImage(join(CROP_DIR, file));
  const row = { idx, expect, results: {} };

  for (const v of variants) {
    const { canvas } = await binarizeImage(img, v.bin);
    const ocrCanvas = await upscaleCanvas(canvas, v.upscale);
    const png = ocrCanvas.toBuffer("image/png");
    const worker = await getWorker(v.psm);
    const { data } = await worker.recognize(png);
    const text = data.text.trim();
    const num = parseDigitRuns(text, v.parse);
    row.results[v.name] = { num, text };

    scores[v.name].total++;
    if (num === expect) {
      scores[v.name].ok++;
    } else if (v.name.startsWith("baseline") && num !== expect) {
      // track fixes vs baseline misread
    }
  }

  const base = row.results[variants[0].name].num;
  const cells = variants.slice(1).map((v) => {
    const n = row.results[v.name].num;
    const mark = n === expect ? "✓" : n === base ? "=" : n ?? "∅";
    return `${String(n ?? "null").padStart(4)}${mark}`;
  });
  console.log(
    `${String(idx).padStart(3)} | ${String(expect).padStart(6)} | ${String(base ?? "null").padStart(8)} | ${cells.join(" | ")}`,
  );
}

console.log("\n--- Accuracy on targets 48–60 (by sort index = filename idxNNN) ---\n");
const baselineName = variants[0].name;
const baselineOk = scores[baselineName]?.ok ?? 0;
for (const v of variants) {
  const s = scores[v.name];
  if (!s) continue;
  const delta = s.ok - baselineOk;
  console.log(
    `${v.name}: ${s.ok}/${s.total}${delta ? ` (${delta >= 0 ? "+" : ""}${delta} vs baseline)` : ""}`,
  );
}

console.log("\n--- Misread focus (50, 53, 58) ---\n");
for (const v of variants) {
  const parts = [];
  for (const idx of [50, 53, 58]) {
    const f = colorFiles.find((c) => c.idx === idx);
    if (!f) continue;
    const img = await loadImage(join(CROP_DIR, f));
    const { canvas } = await binarizeImage(img, v.bin);
    const ocrCanvas = await upscaleCanvas(canvas, v.upscale);
    const worker = await getWorker(v.psm);
    const { data } = await worker.recognize(ocrCanvas.toBuffer("image/png"));
    const num = parseDigitRuns(data.text.trim(), v.parse);
    parts.push(`${idx}→${num ?? "null"}`);
  }
  console.log(`${v.name}: ${parts.join(", ")}`);
}

for (const w of workers.values()) await w.terminate();
