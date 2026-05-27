// Check what parsed.posts has for anchorX/anchorY (browser path)
import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);

for (const p of parsed.posts.sort((a,b) => a.number - b.number)) {
  if (p.pageNum >= 3 && p.pageNum <= 5 && p.number <= 15) {
    console.log(`Post ${String(p.number).padStart(2)}: page=${p.pageNum} x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} anchorX=${p.anchorX?.toFixed(2)} anchorY=${p.anchorY?.toFixed(2)}`);
  }
}
