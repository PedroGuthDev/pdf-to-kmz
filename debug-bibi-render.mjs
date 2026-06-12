/**
 * Render a crop of Bibi Ferreira PDF page 3 around the 02/03/04/05 junction.
 * node debug-bibi-render.mjs [page] [x0] [y0] [x1] [y1] [scale]
 * Coords are scale-1 viewport units.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { ensureNodeCanvasPolyfills, createNodeCanvas } from "./parser/node-canvas-setup.js";

const PDF = "./INFOVIAS_PJC INTERNET_Palhoça_RUA BIBI FERREIRA (Final)_v1.pdf";
const [pageNum, x0, y0, x1, y1, scale] = [
  +(process.argv[2] ?? 3),
  +(process.argv[3] ?? 600),
  +(process.argv[4] ?? 230),
  +(process.argv[5] ?? 900),
  +(process.argv[6] ?? 460),
  +(process.argv[7] ?? 6),
];

await ensureNodeCanvasPolyfills();
const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
lib.GlobalWorkerOptions.workerSrc = new URL(
  "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  import.meta.url,
).href;

const buf = new Uint8Array(readFileSync(PDF));
const doc = await lib.getDocument({
  data: buf,
  standardFontDataUrl: new URL("./node_modules/pdfjs-dist/standard_fonts/", import.meta.url).href,
  disableFontFace: true,
}).promise;

const page = await doc.getPage(pageNum);
const vp = page.getViewport({ scale });
const canvas = await createNodeCanvas(Math.ceil((x1 - x0) * scale), Math.ceil((y1 - y0) * scale));
const ctx = canvas.getContext("2d");
ctx.translate(-x0 * scale, -y0 * scale);
await page.render({ canvasContext: ctx, viewport: vp }).promise;

const out = `bibi-p${pageNum}-crop-${x0}x${y0}.png`;
writeFileSync(out, canvas.toBuffer("image/png"));
console.log(`wrote ${out} (${canvas.width}x${canvas.height})`);
