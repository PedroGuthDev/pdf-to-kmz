import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);
for (const p of parsed.posts.filter((x) => x.number >= 23 && x.number <= 28)) {
  console.log(
    `Post ${p.number}: page=${p.pageNum} x=${p.x.toFixed(1)} y=${p.y.toFixed(1)}`,
  );
}
const d2526 = parsed.distances?.find((d) => d.from === 25 && d.to === 26);
console.log("25→26:", d2526?.meters ?? "null");
