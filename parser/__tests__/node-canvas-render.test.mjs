/**
 * node-canvas-render.test.mjs — pdf.js page rasterization must be non-blank on Node.
 * Run: node parser/__tests__/node-canvas-render.test.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { ensureNodeCanvasPolyfills, createNodeCanvas } from "../node-canvas-setup.js";

const PDF =
  "./INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf";

if (!existsSync(PDF)) {
  console.log("[node-canvas-render] SKIP — sample PDF not in repo");
  process.exit(0);
}

await ensureNodeCanvasPolyfills();
const lib = await import("pdfjs-dist/legacy/build/pdf.mjs");
lib.GlobalWorkerOptions.workerSrc = new URL(
  "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  import.meta.url,
).href;

const buf = new Uint8Array(readFileSync(PDF));
const doc = await lib.getDocument({
  data: buf,
  standardFontDataUrl: new URL(
    "../../node_modules/pdfjs-dist/standard_fonts/",
    import.meta.url,
  ).href,
  disableFontFace: true,
}).promise;

const page = await doc.getPage(3);
const vp = page.getViewport({ scale: 2 });
const canvas = await createNodeCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
const ctx = canvas.getContext("2d");
await page.render({ canvasContext: ctx, viewport: vp }).promise;

const sampleW = Math.min(400, canvas.width);
const sampleH = Math.min(400, canvas.height);
const { data } = ctx.getImageData(0, 0, sampleW, sampleH);
let nonWhite = 0;
for (let i = 0; i < data.length; i += 4) {
  if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) nonWhite++;
}

if (nonWhite < 100) {
  console.error(
    `[node-canvas-render] FAIL — expected rendered content, got ${nonWhite} non-white px`,
  );
  process.exit(1);
}
console.log(
  `[node-canvas-render] PASS — ${nonWhite} non-white pixels in ${sampleW}×${sampleH} sample`,
);
