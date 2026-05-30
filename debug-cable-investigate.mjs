import { parsePdf } from "./parser/pdf-parser.js";
import { buildCablesByPage } from "./parser/cable-builder.js";
import { readFileSync } from "fs";

const pdfBytes = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(pdfBytes.buffer);
const cablesByPage = buildCablesByPage(parsed.cableSegments || parsed.cablePaths || []);
const cable = cablesByPage.get(3)[0];

// Just look at first 30 points
console.log("First 30 cable points:");
for (let i = 0; i < 30; i++) {
  const op = cable[i];
  console.log(`  [${i}] ${op.type} (${op.x?.toFixed(2)}, ${op.y?.toFixed(2)})`);
}
console.log(`Total: ${cable.length} ops`);
