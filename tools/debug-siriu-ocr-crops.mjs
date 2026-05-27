/**
 * Export OCR crops + Tesseract JSON for Siriu (raw reads, no sequence repair).
 *
 *   node tools/debug-siriu-ocr-crops.mjs
 *   node tools/debug-siriu-ocr-crops.mjs --from 45 --to 62
 *
 * Open debug-siriu-ocr-crops/idx050_* for post 50, etc.
 */
import { readFileSync } from "node:fs";
import { parsePdf } from "../parser/pdf-parser.js";

const PDF = "./INFOVIAS_PJC INTERNET_Garopaba_Praia do Siriu_v01.pdf";
const OUT = "./debug-siriu-ocr-crops";

const fromIdx = (() => {
  const i = process.argv.indexOf("--from");
  return i >= 0 ? parseInt(process.argv[i + 1], 10) : 45;
})();
const toIdx = (() => {
  const i = process.argv.indexOf("--to");
  return i >= 0 ? parseInt(process.argv[i + 1], 10) : 62;
})();

function sortOcrResults(ocrResults) {
  return [...ocrResults].sort((a, b) => {
    const pd = (a.circle.pageNum ?? 1) - (b.circle.pageNum ?? 1);
    if (pd !== 0) return pd;
    const dx = a.circle.x - b.circle.x;
    if (Math.abs(dx) > 10) return dx;
    return a.circle.y - b.circle.y;
  });
}

const buf = readFileSync(PDF);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

console.log(`Parsing ${PDF} → ${OUT}\n`);

const parsed = await parsePdf(ab, { ocrDebugDir: OUT });
if (parsed.error) {
  console.error(parsed);
  process.exit(1);
}

const sorted = sortOcrResults(parsed.ocrResults ?? []);
console.log(`Calibrated OCR circles: ${sorted.length}`);
console.log(`Assembled posts (after repair): ${parsed.posts.length}\n`);

console.log(`--- Raw OCR vs sort index (posts ${fromIdx}–${toIdx}) ---\n`);
console.log(
  "idx | raw OCR | repaired post# | page | crop | ring | words (conf)",
);
console.log(
  "----+---------+----------------+------+------+------+------------------",
);

const MISREADS = new Set([30, 93, 8, 99]);

for (let i = fromIdx - 1; i < Math.min(toIdx, sorted.length); i++) {
  const r = sorted[i];
  const expect = i + 1;
  const d = r.ocrDebug;
  const repaired = parsed.posts.find(
    (p) =>
      p.pageNum === r.circle.pageNum &&
      Math.hypot(p.x - r.circle.x, p.y - r.circle.y) < 15,
  )?.number;
  const words = (d?.words ?? [])
    .filter((w) => /\d/.test(w.text))
    .map((w) => `${JSON.stringify(w.text)}@${w.conf?.toFixed(0) ?? "?"}`)
    .join(" ");
  const flag =
    r.number !== expect || MISREADS.has(r.number)
      ? " ← MISREAD"
      : "";
  console.log(
    `${String(i + 1).padStart(3)} | ${String(r.number ?? "null").padStart(7)} | ${String(repaired ?? "?").padStart(14)} | ${String(r.circle.pageNum).padStart(4)} | ${d?.cropPx?.w ?? "?"}×${d?.cropPx?.h ?? "?"} | ${d?.ringFound ? `${d.ringPx.w}×${d.ringPx.h}` : "NO"} | ${words}${flag}`,
  );
}

console.log("\n--- Known bad raw reads in full route ---\n");
for (let i = 0; i < sorted.length; i++) {
  const expect = i + 1;
  const got = sorted[i].number;
  if (got !== expect) {
    console.log(
      `  idx ${i + 1}: expected ${expect}, OCR ${got ?? "null"} (page ${sorted[i].circle.pageNum}) → see ${OUT}/idx${String(i + 1).padStart(3, "0")}_p*_ocr.json`,
    );
  }
}

console.log(
  `\nInspect PNGs: ${OUT}/idx050_p*_ocr_color.png (before binarize), *_bin.png (to Tesseract), *_upscale.png if present.`,
);
