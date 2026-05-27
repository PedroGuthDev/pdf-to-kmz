// Extract raw distance label text to see what's printed on the PDF
import { parsePdf } from "./parser/pdf-parser.js";
import { readFileSync } from "fs";

const pdfBytes = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(pdfBytes.buffer);

// Get all distance items on page 3
const distItems = parsed.distItems || parsed.allDistItems || [];
console.log("distItems total:", distItems.length);
const p3Items = distItems.filter(d => d.pageNum === 3 || d.page === 3);
console.log("page 3 distance items:");
for (const d of p3Items) {
  console.log("  ", d);
}

// And check the textExtractor output for Distância_Poste on page 3
// We'll need to look at allDistItems which should be available in parsed
console.log("\nFull parsed keys:", Object.keys(parsed));
