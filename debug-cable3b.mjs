import { parsePdf } from "./parser/pdf-parser.js";
import { buildCablesByPage } from "./parser/cable-builder.js";
import { readFileSync } from "fs";

const pdfBytes = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(pdfBytes.buffer);
const cablesByPage = buildCablesByPage(parsed.cableSegments || parsed.cablePaths || []);
const cables = cablesByPage.get(3) || [];
console.log(`Page 3 cables: ${cables.length}`);

for (let i = 0; i < cables.length; i++) {
  const c = cables[i];
  console.log(`Cable ${i} keys:`, Object.keys(c));
  console.log(`  first ops:`, c.ops?.slice(0, 5));
  console.log(`  centerline?:`, c.centerline?.slice(0, 5));
}
