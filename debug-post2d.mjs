import { parsePdf } from "./parser/pdf-parser.js";
import { readFileSync } from "fs";

const pdfBytes = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(pdfBytes.buffer);

// distanceLabelItems is the raw text
const items = parsed.distanceLabelItems || [];
console.log("distanceLabelItems total:", items.length);
const p3 = items.filter(d => (d.pageNum ?? d.page) === 3);
console.log("page 3 items:", p3.length);
// Sort by x to get them in route order
p3.sort((a, b) => a.x - b.x);
for (const d of p3.slice(0, 16)) {
  console.log("  ", { x: d.x?.toFixed?.(1), y: d.y?.toFixed?.(1), value: d.value, text: d.text, meters: d.meters });
}
