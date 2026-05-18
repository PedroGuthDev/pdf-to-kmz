// parser/ocr-extractor.js
// OCR-based post number extraction using Tesseract.js.
// Renders each PDF route page to OffscreenCanvas at 2× scale, crops a tight window
// around each circle centroid, and runs Tesseract (digits whitelist, PSM-7).
//
// Worker lifecycle is managed by the caller (pdf-parser.js) — create once before
// the page loop, pass into ocrCircleNumbers, terminate after all pages (WR-05).
//
// Named ESM exports only — no default export, no CommonJS require.

export const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js';

/** @type {((w: number, h: number) => import('canvas').Canvas) | null} */
let _nodeCreateCanvas = null;

async function getNodeCreateCanvas() {
  if (!_nodeCreateCanvas) {
    ({ createCanvas: _nodeCreateCanvas } = await import('canvas'));
  }
  return _nodeCreateCanvas;
}

/**
 * Browser OffscreenCanvas or Node `canvas` package (debug-run-calc.mjs).
 * @param {number} w
 * @param {number} h
 */
async function createOcrCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(w, h);
  }
  if (typeof process !== 'undefined' && process.versions?.node) {
    const createCanvas = await getNodeCreateCanvas();
    return createCanvas(w, h);
  }
  throw new Error('No canvas implementation (OffscreenCanvas or canvas package)');
}

/** @param {OffscreenCanvas | import('canvas').Canvas} */
async function canvasToPngBytes(canvas) {
  if (typeof canvas.convertToBlob === 'function') {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Uint8Array(await blob.arrayBuffer());
  }
  return canvas.toBuffer('image/png');
}

/**
 * Create and configure a Tesseract worker for digit OCR.
 * Caller is responsible for calling worker.terminate() when done.
 *
 * @returns {Promise<import('tesseract.js').Worker>}
 */
export async function createOcrWorker() {
  // Dynamic import — browser uses CDN; Node uses local package when available.
  let createWorker;
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      ({ createWorker } = await import('tesseract.js'));
    } catch {
      ({ createWorker } = (await import(TESSERACT_CDN)).default);
    }
  } else {
    ({ createWorker } = (await import(TESSERACT_CDN)).default);
  }
  const worker = await createWorker('eng', 1, { logger: () => {} });
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789',
    // PSM 6 = single uniform block: most permissive mode that still respects
    // character ordering. Works for binarized digit-on-white crops where the
    // input is short (1–2 chars). PSM 7/8 returned empty even on clean inputs.
    tessedit_pageseg_mode: '6',
  });
  return worker;
}

/**
 * OCR post numbers from rendered circle crops on a single PDF page.
 *
 * @param {import('pdfjs-dist').PDFPageProxy} page
 * @param {number} pageHeight  page.view[3]
 * @param {Array<{x: number, y: number, pageNum?: number}>} circles
 *   Circle centroids with flipY already applied (y = pageHeight - rawY, y increases downward).
 * @param {object|null} ocConfigPromise  Optional OptionalContentConfig promise for forcing all layers visible.
 * @param {import('tesseract.js').Worker} worker  Pre-created Tesseract worker (WR-05: shared across pages).
 * @returns {Promise<Array<{circle: {x: number, y: number, pageNum?: number}, number: number|null}>>}
 */
export async function ocrCircleNumbers(page, pageHeight, circles, ocConfigPromise = null, worker) {
  if (circles.length === 0) return [];

  // STEP 2 — Render full page to OffscreenCanvas. Scale 6× because the overview
  // page (page 2 in INFOVIAS exports) has very small post-marker circles whose
  // digits are only ~6 pt tall. At 4× those rendered to ~24 px which forced a
  // 5× bilinear upscale before OCR (visibly blurry). At 6× they're 36 px native,
  // so any extra upscaling is gentle and digits stay sharp.
  // ocConfigPromise forces all OCG layers visible so post-number paths render even if off by default.
  const SCALE = 6;
  const viewport = page.getViewport({ scale: SCALE });
  const canvasW = Math.ceil(viewport.width);
  const canvasH = Math.ceil(viewport.height);
  const canvas = await createOcrCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d');
  const renderOpts = { canvasContext: ctx, viewport };
  if (ocConfigPromise) renderOpts.optionalContentConfigPromise = ocConfigPromise;
  await page.render(renderOpts).promise;

  // STEP 3 — Locate the visible red marker via connected-component analysis,
  // then crop the *interior* of the ring (where the BLACK digit sits) and OCR.
  //
  // The Numero_Poste CTM (e,f) does NOT sit on the visible circle centre — it's
  // a CAD label-anchor offset by ~5–10 pt. We scan a window around (e,f) for
  // red pixels, group them into connected components, and pick the component
  // whose bbox looks like a small square ring (post marker) — not a long thin
  // shape (cable line) or tall thin shape (red text glyph like "8,03 daN").
  // Then we crop the ring's interior to isolate the digit on a clean white BG.
  // All pixel constants below are derived from SCALE so bumping the render
  // scale doesn't break the size filters.
  const SEARCH_HALF_PX = Math.round(25 * SCALE);  // 25 pt window around (e,f)
  // Expected marker outline bbox: visible circle radius ~5–18 pt → ~10–36 pt
  // diameter → CIRCLE_MIN..CIRCLE_MAX px at the current scale.
  const CIRCLE_MIN_PX = Math.round(5 * SCALE);
  const CIRCLE_MAX_PX = Math.round(22 * SCALE);
  // Minimum canvas dimension fed to Tesseract — anything smaller is upscaled with
  // high-quality smoothing so small page-overview circles still have enough pixels
  // per digit (Tesseract's reliable threshold is ~25 px character height).
  const MIN_OCR_DIM = 120;
  const results = [];

  /**
   * Connected components of red pixels in a window around (cx, cy).
   * @param {number} cx  candidate centre, canvas pixels
   * @param {number} cy  candidate centre, canvas pixels
   * @returns {Array<{ bbox: {minX:number, minY:number, maxX:number, maxY:number},
   *                    center: {x:number, y:number}, width:number, height:number,
   *                    aspect:number, pixels:number }>}
   */
  function findRedComponents(cx, cy) {
    const sx = Math.max(0, cx - SEARCH_HALF_PX);
    const sy = Math.max(0, cy - SEARCH_HALF_PX);
    const sw = Math.min(SEARCH_HALF_PX * 2, canvasW - sx);
    const sh = Math.min(SEARCH_HALF_PX * 2, canvasH - sy);
    if (sw <= 0 || sh <= 0) return [];
    const { data } = ctx.getImageData(sx, sy, sw, sh);
    const mask = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const idx = (y * sw + x) * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
        if (a > 200 && r > 180 && g < 100 && b < 100) mask[y * sw + x] = 1;
      }
    }
    const visited = new Uint8Array(sw * sh);
    const components = [];
    const queue = [];
    for (let startY = 0; startY < sh; startY++) {
      for (let startX = 0; startX < sw; startX++) {
        const startI = startY * sw + startX;
        if (!mask[startI] || visited[startI]) continue;
        let minX = startX, minY = startY, maxX = startX, maxY = startY;
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
          if (px > 0)      { const n = i - 1;  if (mask[n] && !visited[n]) { visited[n] = 1; queue.push(n); } }
          if (px < sw - 1) { const n = i + 1;  if (mask[n] && !visited[n]) { visited[n] = 1; queue.push(n); } }
          if (py > 0)      { const n = i - sw; if (mask[n] && !visited[n]) { visited[n] = 1; queue.push(n); } }
          if (py < sh - 1) { const n = i + sw; if (mask[n] && !visited[n]) { visited[n] = 1; queue.push(n); } }
        }
        const cw = maxX - minX + 1;
        const ch = maxY - minY + 1;
        components.push({
          bbox: { minX: minX + sx, minY: minY + sy, maxX: maxX + sx, maxY: maxY + sy },
          center: { x: (minX + maxX) / 2 + sx, y: (minY + maxY) / 2 + sy },
          width: cw, height: ch, aspect: cw / ch, pixels: count,
        });
      }
    }
    return components;
  }

  // Cap debug data-URL emissions so we can see crops without flooding the console.
  let cropsLogged = 0;
  const DEBUG_CROPS_PER_PAGE = 6;

  for (const circle of circles) {
    const rawCx = Math.round(circle.x * SCALE);
    const rawCy = Math.round(circle.y * SCALE);

    const components = findRedComponents(rawCx, rawCy);
    const ringCandidates = components.filter(c =>
      c.width  >= CIRCLE_MIN_PX && c.width  <= CIRCLE_MAX_PX &&
      c.height >= CIRCLE_MIN_PX && c.height <= CIRCLE_MAX_PX &&
      c.aspect >= 0.6 && c.aspect <= 1.7
    );
    let ring = null, ringDist = Infinity;
    for (const c of ringCandidates) {
      const d = Math.hypot(c.center.x - rawCx, c.center.y - rawCy);
      if (d < ringDist) { ringDist = d; ring = c; }
    }

    // Ring center in flipY PDF pt — this is the visual center of the post symbol,
    // more accurate than the CTM anchor stored in circle.x/y (which is a label offset).
    const ringCenterPt = ring
      ? { x: ring.center.x / SCALE, y: ring.center.y / SCALE }
      : null;

    let cropX, cropY, cropW, cropH;
    if (ring) {
      // Adaptive shrink: 15% of the smaller dimension, floor 2 px. Keeps small
      // overview-page rings from clipping their digit while letting bigger zoom
      // rings strip more of the red outline.
      const ringShrink = Math.max(2, Math.floor(Math.min(ring.width, ring.height) * 0.15));
      cropX = ring.bbox.minX + ringShrink;
      cropY = ring.bbox.minY + ringShrink;
      cropW = ring.width  - ringShrink * 2;
      cropH = ring.height - ringShrink * 2;
      if (cropW < 12 || cropH < 12) {
        cropX = ring.bbox.minX; cropY = ring.bbox.minY;
        cropW = ring.width;     cropH = ring.height;
      }
      console.info(
        `[ocr] page=${circle.pageNum ?? '?'} (${rawCx},${rawCy}) ring=${ring.width}×${ring.height}` +
        ` shrink=${ringShrink}` +
        ` Δ=(${(ring.center.x - rawCx).toFixed(0)},${(ring.center.y - rawCy).toFixed(0)})` +
        ` candidates=${ringCandidates.length}/${components.length}`
      );
    } else {
      // Fallback: fixed 50 px (12.5 pt) crop at the path centroid.
      cropX = Math.max(0, rawCx - 50);
      cropY = Math.max(0, rawCy - 50);
      cropW = Math.min(100, canvasW - cropX);
      cropH = Math.min(100, canvasH - cropY);
      console.info(
        `[ocr] page=${circle.pageNum ?? '?'} (${rawCx},${rawCy}) NO red ring found ` +
        `(components=${components.length}) — using raw-centred fallback crop`
      );
    }

    if (cropW <= 0 || cropH <= 0) {
      results.push({ circle, number: null, ringCenter: ringCenterPt });
      continue;
    }

    const cropCanvas = await createOcrCanvas(cropW, cropH);
    const cropCtx = cropCanvas.getContext('2d');
    cropCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    // Binarise to black-on-white: any dark pixel becomes the digit, everything
    // else (red ring outline, off-white background, anti-aliasing halo) becomes
    // pure white. Gives Tesseract a textbook OCR input.
    const cropImg = cropCtx.getImageData(0, 0, cropW, cropH);
    const cd = cropImg.data;
    for (let i = 0; i < cd.length; i += 4) {
      const dark = cd[i] < 110 && cd[i + 1] < 110 && cd[i + 2] < 110;
      if (dark) {
        cd[i] = 0; cd[i + 1] = 0; cd[i + 2] = 0;
      } else {
        cd[i] = 255; cd[i + 1] = 255; cd[i + 2] = 255;
      }
      cd[i + 3] = 255;
    }
    cropCtx.putImageData(cropImg, 0, 0);

    // Upscale tiny crops (page-overview rings) with high-quality smoothing so
    // Tesseract has enough pixels per digit to commit (≥25 px char height).
    let ocrSource = cropCanvas;
    if (cropW < MIN_OCR_DIM || cropH < MIN_OCR_DIM) {
      const scaleUp = Math.max(MIN_OCR_DIM / cropW, MIN_OCR_DIM / cropH);
      const upW = Math.round(cropW * scaleUp);
      const upH = Math.round(cropH * scaleUp);
      ocrSource = await createOcrCanvas(upW, upH);
      const upCtx = ocrSource.getContext('2d');
      upCtx.imageSmoothingEnabled = true;
      upCtx.imageSmoothingQuality = 'high';
      upCtx.drawImage(cropCanvas, 0, 0, upW, upH);
    }

    // Convert to Blob — more reliable than OffscreenCanvas across Tesseract.js versions
    const pngBytes = await canvasToPngBytes(ocrSource);
    if (!pngBytes?.length || pngBytes.length < 64) {
      results.push({ circle, number: null, ringCenter: ringCenterPt });
      continue;
    }
    const { data } = await worker.recognize(pngBytes);
    const text = data.text.trim();
    // Lenient parse: pick the last digit run (Tesseract may emit "001" when the
    // red ring is read as a leading "0", or " 1 " with stray spaces). The trailing
    // run is the digit inside the ring. MAX_PLAUSIBLE_POST gating happens later.
    const runs = text.match(/\d{1,3}/g);
    const num = runs && runs.length > 0 ? parseInt(runs[runs.length - 1], 10) : null;
    console.info(
      `[ocr] page=${circle.pageNum ?? '?'} circle=(${circle.x.toFixed(0)},${circle.y.toFixed(0)})` +
      ` ocr=${JSON.stringify(text)} → number=${num}`
    );

    // Emit the first few FAILED crops as data URLs so we can diagnose why OCR
    // missed them. Successful reads don't need visual inspection. Open the URL
    // in a browser tab to see exactly what Tesseract was given.
    if (num === null && cropsLogged < DEBUG_CROPS_PER_PAGE) {
      const u8 = pngBytes instanceof Uint8Array ? pngBytes : new Uint8Array(pngBytes);
      let bin = '';
      for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
      console.info(`[ocr-crop] page=${circle.pageNum ?? '?'} (${circle.x.toFixed(0)},${circle.y.toFixed(0)}) data:image/png;base64,${btoa(bin)}`);
      cropsLogged++;
    }

    results.push({ circle, number: num, ringCenter: ringCenterPt });
  }

  return results;
}
