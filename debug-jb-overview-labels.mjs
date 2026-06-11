// JB overview page (2): associate the 33 distance labels to the 34 posts'
// consecutive chords using overview circle positions. Authoritative chain.
import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);

console.log("posts pageNums:", [...new Set(parsed.posts.map((p) => p.pageNum))]);
const labels = parsed.distanceLabelItems ?? [];
const pages = {};
for (const it of labels) pages[it.pageNum ?? 1] = (pages[it.pageNum ?? 1] ?? 0) + 1;
console.log("labels per page:", pages);

const pg2 = labels.filter((it) => (it.pageNum ?? 1) === 2);
console.log(`\n=== page-2 labels (${pg2.length}) ===`);
for (const it of pg2) {
  const w = typeof it.width === "number" && it.width > 0 ? it.width : 0;
  console.log(`"${it.str}" @ (${(it.x + w / 2).toFixed(1)}, ${it.y.toFixed(1)})`);
}

// overview circles: are they exposed anywhere?
console.log("\nparsed keys:", Object.keys(parsed));
const ov = parsed.overviewPosts ?? parsed.postsPerPage?.get?.(2);
console.log("overview posts available:", ov ? ov.length : "no");
