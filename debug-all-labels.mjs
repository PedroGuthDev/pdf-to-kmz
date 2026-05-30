import { parsePdf } from "./parser/pdf-parser.js";
import { associateDistances } from "./parser/distance-associator.js";
import { readFileSync } from "fs";
import { computeScaleFactor } from "./parser/geo/utm-calibrator.js";

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

// Load posts from debug_results.txt
const text = readFileSync("./debug_results.txt", "utf8");
const dumpIdx = text.indexOf("PARSE DEBUG DUMP");
const block = text.slice(dumpIdx, text.indexOf("\nPage dimensions", dumpIdx));
const byNum = new Map();
for (const line of block.split("\n")) {
  const m = line.match(/Post\s+(\d+):\s+page=(\d+)\s+x=([\d.]+)\s+y=([\d.]+)/);
  if (!m) continue;
  const num = parseInt(m[1], 10);
  if (byNum.has(num)) continue;
  byNum.set(num, { number: num, pageNum: parseInt(m[2], 10), x: parseFloat(m[3]), y: parseFloat(m[4]) });
}
const posts = [...byNum.values()].sort((a, b) => a.number - b.number);

const overviewScale = computeScaleFactor(parsed.utmGridPathsPerPage?.get(2) ?? [], []);
const perPageScale = (pn) => {
  const paths = parsed.utmGridPathsPerPage?.get(pn);
  if (paths?.length) { const sf = computeScaleFactor(paths, []); if (sf != null) return sf; }
  return overviewScale;
};
const { distances } = associateDistances(posts, parsed.distanceLabelItems, [], { perPageScale });
console.log("All distance labels:");
for (const d of distances) {
  if (d.meters != null) console.log(`  ${d.from}->${d.to}: ${d.meters.toFixed(2)}m`);
}
