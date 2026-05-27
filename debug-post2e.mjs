import { parsePdf } from "./parser/pdf-parser.js";
import { readFileSync } from "fs";

const pdfBytes = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(pdfBytes.buffer);

const items = parsed.distanceLabelItems || [];
const p3 = items.filter(d => (d.pageNum ?? d.page) === 3);
console.log("page 3 items keys:", Object.keys(p3[0] || {}));
p3.sort((a, b) => a.x - b.x);
for (const d of p3.slice(0, 16)) {
  console.log(JSON.stringify(d));
}
