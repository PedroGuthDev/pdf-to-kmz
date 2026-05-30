// parser/ocr-extractor.js
// OCR-based post number extraction using Tesseract.js.
// Renders each PDF route page to OffscreenCanvas at 2× scale, crops a tight window
// around each circle centroid, and runs Tesseract (digits whitelist, PSM-7).
//
// Worker lifecycle is managed by the caller (pdf-parser.js) — create once before
// the page loop, pass into ocrCircleNumbers, terminate after all pages (WR-05).
//
// Named ESM exports only — no default export, no CommonJS require.

import {
  createIsomorphicCanvas,
  isNodeRuntime,
} from "./node-canvas-setup.js";

export const TESSERACT_CDN =
  "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js";

let _fsPromise = null;
async function getFs() {
  if (isNodeRuntime()) {
    if (!_fsPromise) {
      _fsPromise = Promise.all([
        import("node:fs"),
        import("node:path"),
      ]).then(([fs, path]) => ({ fs, path }));
    }
    return _fsPromise;
  }
  return null;
}

const RED_MARKER_COLOR_BOUNDS = { minA: 200, minR: 180, maxG: 100, maxB: 100 };

/** @param {OffscreenCanvas | import('@napi-rs/canvas').Canvas} */
async function canvasToPngBytes(canvas) {
  if (typeof canvas.convertToBlob === "function") {
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return new Uint8Array(await blob.arrayBuffer());
  }
  return canvas.toBuffer("image/png");
}

/**
 * Otsu threshold on grayscale histogram.
 * @param {Uint32Array} hist
 * @param {number} n pixel count
 */
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
 * Binarize RGBA crop: Otsu on luminance (sharper strokes than fixed threshold 110).
 * @param {Uint8ClampedArray} cd
 * @param {number} w
 * @param {number} h
 */
function binarizeCropOtsu(cd, w, h) {
  const hist = new Uint32Array(256);
  const n = w * h;
  const lum = new Uint8Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const g = Math.round(0.299 * cd[i] + 0.587 * cd[i + 1] + 0.114 * cd[i + 2]);
    lum[p] = g;
    hist[g]++;
  }
  const thresh = otsuThreshold(hist, n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const v = lum[p] < thresh ? 0 : 255;
    cd[i] = cd[i + 1] = cd[i + 2] = v;
    cd[i + 3] = 255;
  }
}

/**
 * Connected components of red pixels in a window around (cx, cy).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} searchHalfPx
 * @param {number} canvasW
 * @param {number} canvasH
 */
function findRedComponents(ctx, cx, cy, searchHalfPx, canvasW, canvasH) {
  const sx = Math.max(0, cx - searchHalfPx);
  const sy = Math.max(0, cy - searchHalfPx);
  const sw = Math.min(searchHalfPx * 2, canvasW - sx);
  const sh = Math.min(searchHalfPx * 2, canvasH - sy);
  if (sw <= 0 || sh <= 0) return [];
  const { data } = ctx.getImageData(sx, sy, sw, sh);
  const mask = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const idx = (y * sw + x) * 4;
      const r = data[idx],
        g = data[idx + 1],
        b = data[idx + 2],
        a = data[idx + 3];
      if (
        a > RED_MARKER_COLOR_BOUNDS.minA &&
        r > RED_MARKER_COLOR_BOUNDS.minR &&
        g < RED_MARKER_COLOR_BOUNDS.maxG &&
        b < RED_MARKER_COLOR_BOUNDS.maxB
      ) {
        mask[y * sw + x] = 1;
      }
    }
  }
  const visited = new Uint8Array(sw * sh);
  const components = [];
  const queue = [];
  for (let startY = 0; startY < sh; startY++) {
    for (let startX = 0; startX < sw; startX++) {
      const startI = startY * sw + startX;
      if (!mask[startI] || visited[startI]) continue;
      let minX = startX,
        minY = startY,
        maxX = startX,
        maxY = startY;
      let count = 0;
      queue.length = 0;
      queue.push(startI);
      visited[startI] = 1;
      let qHead = 0;
      while (qHead < queue.length) {
        const i = queue[qHead++];
        const py = Math.floor(i / sw);
        const px = i - py * sw;
        count++;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        if (px > 0) {
          const n = i - 1;
          if (mask[n] && !visited[n]) {
            visited[n] = 1;
            queue.push(n);
          }
        }
        if (px < sw - 1) {
          const n = i + 1;
          if (mask[n] && !visited[n]) {
            visited[n] = 1;
            queue.push(n);
          }
        }
        if (py > 0) {
          const n = i - sw;
          if (mask[n] && !visited[n]) {
            visited[n] = 1;
            queue.push(n);
          }
        }
        if (py < sh - 1) {
          const n = i + sw;
          if (mask[n] && !visited[n]) {
            visited[n] = 1;
            queue.push(n);
          }
        }
      }
      const cw = maxX - minX + 1;
      const ch = maxY - minY + 1;
      components.push({
        bbox: {
          minX: minX + sx,
          minY: minY + sy,
          maxX: maxX + sx,
          maxY: maxY + sy,
        },
        center: { x: (minX + maxX) / 2 + sx, y: (minY + maxY) / 2 + sy },
        width: cw,
        height: ch,
        aspect: cw / ch,
        pixels: count,
      });
    }
  }
  return components;
}

/**
 * Locate the visible red marker ring near the given coordinates using component analysis.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx
 * @param {number} cy
 * @param {number} scale
 * @param {number} canvasW
 * @param {number} canvasH
 * @returns {object} { ring, components, ringCandidates }
 */
export function locateRedMarkerRing(ctx, cx, cy, scale, canvasW, canvasH) {
  const searchHalfPx = Math.round(25 * scale);
  const circleMinPx = Math.round(5 * scale);
  const circleMaxPx = Math.round(22 * scale);

  const components = findRedComponents(ctx, cx, cy, searchHalfPx, canvasW, canvasH);
  const ringCandidates = components.filter(
    (c) =>
      c.width >= circleMinPx &&
      c.width <= circleMaxPx &&
      c.height >= circleMinPx &&
      c.height <= circleMaxPx &&
      c.aspect >= 0.6 &&
      c.aspect <= 1.7,
  );
  let ring = null;
  let ringDist = Infinity;
  for (const c of ringCandidates) {
    const d = Math.hypot(c.center.x - cx, c.center.y - cy);
    if (d < ringDist) {
      ringDist = d;
      ring = c;
    }
  }
  return { ring, components, ringCandidates };
}

/**
 * Parse Tesseract digit output. Prefer the longest digit run (full label) over the
 * last run.
 * @param {string} text
 * @returns {number|null}
 */
export function parseOcrDigitText(text) {
  const runs = text.trim().match(/\d{1,3}/g);
  if (!runs?.length) return null;
  const best = runs.reduce((a, b) => (b.length > a.length ? b : a));
  return parseInt(best, 10);
}

/** @param {string} dir */
async function writeDebugPng(dir, name, canvas) {
  const nodeFs = await getFs();
  if (!nodeFs) return;
  const { fs, path } = nodeFs;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), await canvasToPngBytes(canvas));
}

/**
 * Create and configure a Tesseract worker for digit OCR.
 * Caller is responsible for calling worker.terminate() when done.
 *
 * @returns {Promise<import('tesseract.js').Worker>}
 */
export async function createOcrWorker() {
  let createWorker;
  if (isNodeRuntime()) {
    try {
      ({ createWorker } = await import("tesseract.js"));
    } catch {
      ({ createWorker } = (await import(TESSERACT_CDN)).default);
    }
  } else {
    ({ createWorker } = (await import(TESSERACT_CDN)).default);
  }
  const worker = await createWorker("eng", 1, { logger: () => {} });
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: "7",
  });
  return worker;
}

/**
 * Some crops regress under Otsu+nearest with PSM 7. Retry with PSM 6 and prefer
 * the parse with a longer digit run (or higher confidence when tied).
 *
 * @param {import('tesseract.js').Worker} worker
 * @param {Uint8Array} pngBytes
 * @returns {Promise<{data: any, text: string, num: number|null}>}
 */
async function recognizeDigitsWithFallback(worker, pngBytes) {
  const runWithPsm = async (psm) => {
    await worker.setParameters({ tessedit_pageseg_mode: String(psm) });
    const { data } = await worker.recognize(pngBytes);
    const text = (data.text ?? "").trim();
    return { data, text, num: parseOcrDigitText(text) };
  };

  const p7 = await runWithPsm(7);
  const digits7 = p7.text.match(/\d{1,3}/g) ?? [];
  if (digits7.some((r) => r.length >= 2)) return p7;

  const p6 = await runWithPsm(6);
  const digits6 = p6.text.match(/\d{1,3}/g) ?? [];

  const bestLen7 = digits7.reduce((m, r) => Math.max(m, r.length), 0);
  const bestLen6 = digits6.reduce((m, r) => Math.max(m, r.length), 0);
  if (bestLen6 > bestLen7) return p6;
  if (bestLen7 > bestLen6) return p7;

  const conf7 = p7.data?.words?.[0]?.confidence ?? 0;
  const conf6 = p6.data?.words?.[0]?.confidence ?? 0;
  return conf6 > conf7 ? p6 : p7;
}

/**
 * OCR post numbers from rendered circle crops on a single PDF page.
 *
 * @param {import('pdfjs-dist').PDFPageProxy} page
 * @param {number} pageHeight  page.view[3]
 * @param {Array<{x: number, y: number, pageNum?: number}>} circles
 * @param {object|null} ocConfigPromise
 * @param {import('tesseract.js').Worker} worker
 * @param {{ debugDir?: string, sortIndexBase?: number }} [options]
 * @returns {Promise<Array<{circle: {x: number, y: number, pageNum?: number}, number: number|null, ocrDebug?: object}>>}
 */
export async function ocrCircleNumbers(
  page,
  pageHeight,
  circles,
  ocConfigPromise = null,
  worker,
  options = {},
) {
  const { debugDir = null, sortIndexBase = 0 } = options;
  if (circles.length === 0) return [];

  const SCALE = 6;
  const viewport = page.getViewport({ scale: SCALE });
  const canvasW = Math.ceil(viewport.width);
  const canvasH = Math.ceil(viewport.height);
  const canvas = await createIsomorphicCanvas(canvasW, canvasH);
  const ctx = canvas.getContext("2d");
  const renderOpts = { canvasContext: ctx, viewport };
  if (ocConfigPromise)
    renderOpts.optionalContentConfigPromise = ocConfigPromise;
  await page.render(renderOpts).promise;

  const MIN_OCR_DIM = 120;
  const results = [];

  let cropsLogged = 0;
  const DEBUG_CROPS_PER_PAGE = 6;

  for (let ci = 0; ci < circles.length; ci++) {
    const circle = circles[ci];
    const sortIdx = sortIndexBase + ci;
    const rawCx = Math.round(circle.x * SCALE);
    const rawCy = Math.round(circle.y * SCALE);

    const { ring, components, ringCandidates } = locateRedMarkerRing(
      ctx,
      rawCx,
      rawCy,
      SCALE,
      canvasW,
      canvasH
    );

    const ringCenterPt = ring
      ? { x: ring.center.x / SCALE, y: ring.center.y / SCALE }
      : null;

    let cropX, cropY, cropW, cropH;
    if (ring) {
      const ringShrink = Math.max(
        2,
        Math.floor(Math.min(ring.width, ring.height) * 0.15),
      );
      cropX = ring.bbox.minX + ringShrink;
      cropY = ring.bbox.minY + ringShrink;
      cropW = ring.width - ringShrink * 2;
      cropH = ring.height - ringShrink * 2;
      if (cropW < 12 || cropH < 12) {
        cropX = ring.bbox.minX;
        cropY = ring.bbox.minY;
        cropW = ring.width;
        cropH = ring.height;
      }
      console.info(
        `[ocr] page=${circle.pageNum ?? "?"} (${rawCx},${rawCy}) ring=${ring.width}×${ring.height}` +
          ` shrink=${ringShrink}` +
          ` Δ=(${(ring.center.x - rawCx).toFixed(0)},${(ring.center.y - rawCy).toFixed(0)})` +
          ` candidates=${ringCandidates.length}/${components.length}`,
      );
    } else {
      cropX = Math.max(0, rawCx - 50);
      cropY = Math.max(0, rawCy - 50);
      cropW = Math.min(100, canvasW - cropX);
      cropH = Math.min(100, canvasH - cropY);
      console.info(
        `[ocr] page=${circle.pageNum ?? "?"} (${rawCx},${rawCy}) NO red ring found ` +
          `(components=${components.length}) — using raw-centred fallback crop`,
      );
    }

    if (cropW <= 0 || cropH <= 0) {
      results.push({ circle, number: null, ringCenter: ringCenterPt });
      continue;
    }

    const cropCanvas = await createIsomorphicCanvas(cropW, cropH);
    const cropCtx = cropCanvas.getContext("2d");
    cropCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    const debugStem = debugDir
      ? `idx${String(sortIdx + 1).padStart(3, "0")}_p${circle.pageNum ?? 0}_ocr`
      : null;
    if (debugStem) {
      await writeDebugPng(debugDir, `${debugStem}_color.png`, cropCanvas);
    }

    const cropImg = cropCtx.getImageData(0, 0, cropW, cropH);
    binarizeCropOtsu(cropImg.data, cropW, cropH);
    cropCtx.putImageData(cropImg, 0, 0);
    if (debugStem) {
      await writeDebugPng(debugDir, `${debugStem}_bin.png`, cropCanvas);
    }

    let ocrSource = cropCanvas;
    if (cropW < MIN_OCR_DIM || cropH < MIN_OCR_DIM) {
      const scaleUp = Math.max(MIN_OCR_DIM / cropW, MIN_OCR_DIM / cropH);
      const upW = Math.round(cropW * scaleUp);
      const upH = Math.round(cropH * scaleUp);
      ocrSource = await createIsomorphicCanvas(upW, upH);
      const upCtx = ocrSource.getContext("2d");
      upCtx.imageSmoothingEnabled = false;
      upCtx.drawImage(cropCanvas, 0, 0, upW, upH);
    }

    const pngBytes = await canvasToPngBytes(ocrSource);
    if (!pngBytes?.length || pngBytes.length < 64) {
      results.push({ circle, number: null, ringCenter: ringCenterPt });
      continue;
    }
    if (debugStem && ocrSource !== cropCanvas) {
      await writeDebugPng(debugDir, `${debugStem}_upscale.png`, ocrSource);
    }

    const { data, text, num } = await recognizeDigitsWithFallback(
      worker,
      pngBytes,
    );
    const runs = text.match(/\d{1,3}/g);

    const ocrDebug = debugStem
      ? {
          sortIndex: sortIdx + 1,
          pageNum: circle.pageNum,
          circle: { x: circle.x, y: circle.y },
          ringFound: !!ring,
          ringPx: ring ? { w: ring.width, h: ring.height } : null,
          ringShrink: ring
            ? Math.max(2, Math.floor(Math.min(ring.width, ring.height) * 0.15))
            : null,
          cropPx: { w: cropW, h: cropH },
          upscaled: ocrSource !== cropCanvas,
          ocrText: text,
          digitRuns: runs,
          parsedNumber: num,
          words: (data.words ?? []).map((w) => ({
            text: w.text,
            conf: w.confidence,
            bbox: w.bbox,
          })),
          symbols: (data.symbols ?? []).slice(0, 20).map((s) => ({
            text: s.text,
            conf: s.confidence,
          })),
        }
      : undefined;

    if (debugStem) {
      const nodeFs = await getFs();
      if (nodeFs) {
        const { fs, path } = nodeFs;
        fs.writeFileSync(
          path.join(debugDir, `${debugStem}.json`),
          JSON.stringify(ocrDebug, null, 2),
        );
      }
    }
    console.info(
      `[ocr] page=${circle.pageNum ?? "?"} circle=(${circle.x.toFixed(0)},${circle.y.toFixed(0)})` +
        ` ocr=${JSON.stringify(text)} → number=${num}`,
    );

    if (num === null && cropsLogged < DEBUG_CROPS_PER_PAGE) {
      const u8 =
        pngBytes instanceof Uint8Array ? pngBytes : new Uint8Array(pngBytes);
      let bin = "";
      for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
      console.info(
        `[ocr-crop] page=${circle.pageNum ?? "?"} (${circle.x.toFixed(0)},${circle.y.toFixed(0)}) data:image/png;base64,${btoa(bin)}`,
      );
      cropsLogged++;
    }

    results.push({ circle, number: num, ringCenter: ringCenterPt, ocrDebug });
  }

  return results;
}
