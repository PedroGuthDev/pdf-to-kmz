import { parsePdf } from "./parser/pdf-parser.js";
import { buildCablesByPage, isOffRouteCablePost } from "./parser/cable-builder.js";
import { readFileSync } from "fs";

const pdfBytes = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(pdfBytes.buffer);
const cablesByPage = buildCablesByPage(parsed.cableSegments || parsed.cablePaths || []);
const postByNum = new Map(parsed.posts.map(p => [p.number, p]));

for (let i = 1; i <= 14; i++) {
  const p = parsed.posts.find(x => x.number === i);
  if (!p) continue;
  const isAux = isOffRouteCablePost(p, postByNum, cablesByPage);
  console.log(`  post ${i}: isAux=${isAux}`);
}
