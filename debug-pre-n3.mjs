import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const p = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);
const w = p.warnings.filter((x) => /sheet entry|25→26|25 and 26/.test(x));
console.log("warnings", w);
for (const n of [24, 25, 26, 34]) {
  const post = p.posts.find((x) => x.number === n);
  console.log(`Post ${n}: x=${post?.x?.toFixed(1)} page=${post?.pageNum}`);
}
console.log("25→26", p.distances.find((d) => d.from === 25)?.meters);
