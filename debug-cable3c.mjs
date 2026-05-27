import { parsePdf } from "./parser/pdf-parser.js";
import { buildCablesByPage } from "./parser/cable-builder.js";
import { readFileSync } from "fs";

const pdfBytes = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(pdfBytes.buffer);
const cablesByPage = buildCablesByPage(parsed.cableSegments || parsed.cablePaths || []);
const cables = cablesByPage.get(3) || [];
const cable = cables[0]; // it's the array itself
console.log("Cable length:", cable.length);
console.log("First 3 elements:", cable.slice(0, 3));
