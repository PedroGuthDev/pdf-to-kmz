// parser/ocr-extractor.js
// OCR-based post number extraction using Tesseract.js.
// Renders each PDF route page to OffscreenCanvas at 2× scale, crops a 120px window
// around each circle centroid, and runs Tesseract (digits whitelist, PSM-7).
//
// Named ESM export only — no default export, no CommonJS require.

const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js';

/**
 * OCR post numbers from rendered circle crops on a single PDF page.
 *
 * @param {import('pdfjs-dist').PDFPageProxy} page
 * @param {number} pageHeight  page.view[3]
 * @param {Array<{x: number, y: number, pageNum?: number}>} circles
 *   Circle centroids with flipY already applied (y = pageHeight - rawY, y increases downward).
 * @returns {Promise<Array<{circle: {x: number, y: number, pageNum?: number}, number: number|null}>>}
 */
export async function ocrCircleNumbers(page, pageHeight, circles) {
  if (circles.length === 0) return [];

  // STEP 2 — Render full page to OffscreenCanvas at scale 2 (D-08: one render call, multiple crops)
  const SCALE = 2;
  const viewport = page.getViewport({ scale: SCALE });
  const canvasW = Math.ceil(viewport.width);
  const canvasH = Math.ceil(viewport.height);
  const canvas = new OffscreenCanvas(canvasW, canvasH);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;

  // STEP 3 — Initialize Tesseract.js worker (D-09: digits whitelist, PSM-7)
  // Dynamic import so a CDN failure at load time doesn't prevent the event listener from registering.
  const { createWorker } = await import(TESSERACT_CDN);
  const worker = await createWorker('eng', 1, { logger: () => {} });
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789',
    tessedit_pageseg_mode: '7',
  });

  // STEP 4 — For each circle, crop and OCR
  // Crop radius: 60pt at 2× scale = 120px total crop window
  // Circle center in canvas coordinates:
  //   canvasCx = Math.round(circle.x * SCALE)  — x unchanged (no flipY on x)
  //   canvasCy = Math.round(circle.y * SCALE)  — circle.y is already flipY distance from top
  const CROP_RADIUS_PX = 60; // 60pt at 2× = 120px total crop window
  const results = [];

  for (const circle of circles) {
    const canvasCx = Math.round(circle.x * SCALE);
    const canvasCy = Math.round(circle.y * SCALE);
    const cropX = Math.max(0, canvasCx - CROP_RADIUS_PX);
    const cropY = Math.max(0, canvasCy - CROP_RADIUS_PX);
    const cropW = Math.min(CROP_RADIUS_PX * 2, canvasW - cropX);
    const cropH = Math.min(CROP_RADIUS_PX * 2, canvasH - cropY);

    if (cropW <= 0 || cropH <= 0) {
      results.push({ circle, number: null });
      continue;
    }

    // Extract crop into a fresh OffscreenCanvas for Tesseract (T-04-02: bounds clamped above)
    const cropCanvas = new OffscreenCanvas(cropW, cropH);
    const cropCtx = cropCanvas.getContext('2d');
    cropCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    // Tesseract accepts Blob, ImageData, HTMLCanvas, OffscreenCanvas, or URL
    const { data } = await worker.recognize(cropCanvas);
    const text = data.text.trim();
    const num = /^\d{1,3}$/.test(text) ? parseInt(text, 10) : null;
    results.push({ circle, number: num });
  }

  // STEP 5 — Terminate worker and return
  await worker.terminate();
  return results;
}
