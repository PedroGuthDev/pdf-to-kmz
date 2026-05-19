// analyze-utm-labels.mjs — G-3 feasibility: absolute UTM easting/northing text on grid (N7).
// Usage: node analyze-utm-labels.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const PDFS = [
  {
    key: 'valmor',
    label: 'Palhoça — Valmor Francisco v1',
    path: './INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf',
  },
  {
    key: 'joao_born',
    label: 'Palhoça — Joao Born v04',
    path: './INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf',
  },
  {
    key: 'luiz_carolino',
    label: 'São José — Luiz Carolino Pereira v1 (AAF)',
    path: './INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf',
  },
  {
    key: 'siriu',
    label: 'Garopaba — Praia do Siriu v01',
    path: './INFOVIAS_PJC INTERNET_Garopaba_Praia do Siriu_v01.pdf',
  },
];

/** @type {RegExp[]} */
const PATTERNS = [
  { name: 'easting_suffix_E', re: /\b(\d{6,7})\s*[mM]?\s*[Ee]\b/g },
  { name: 'northing_suffix_N', re: /\b(\d{6,7})\s*[mM]?\s*[Nn]\b/g },
  { name: 'comma_grouped', re: /\b(\d{3,4})[\s,](\d{3})\b/g },
  { name: 'plain_6_7_digit', re: /\b(\d{6,7})\b/g },
];

/**
 * @param {string} text
 * @returns {Array<{ pattern: string, match: string, value?: number, axis?: 'E'|'N' }>}
 */
function scanUtmLikeText(text) {
  if (!text || text.length < 4) return [];
  const hits = [];
  const seen = new Set();

  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const match = m[0];
      const key = `${name}:${match}`;
      if (seen.has(key)) continue;
      seen.add(key);

      let value;
      let axis;
      if (name === 'comma_grouped') {
        value = parseInt(m[1].replace(/\D/g, ''), 10) * 1000 + parseInt(m[2], 10);
      } else {
        value = parseInt(m[1], 10);
      }
      if (name === 'easting_suffix_E') axis = 'E';
      if (name === 'northing_suffix_N') axis = 'N';
      if (value >= 100000 && value <= 9999999) {
        hits.push({ pattern: name, match, value, axis });
      }
    }
  }
  return hits;
}

const pdfjsLib = await import('./node_modules/pdfjs-dist/legacy/build/pdf.mjs');
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
  import.meta.url
).href;

/** @param {{ key: string, label: string, path: string }} spec */
async function analyzePdf(spec) {
  const data = new Uint8Array(readFileSync(spec.path));
  const pdfDoc = await pdfjsLib.getDocument({
    data,
    standardFontDataUrl: new URL('./node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
  }).promise;

  const pages = [];
  let totalHits = 0;
  let axisHits = 0;

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const tc = await page.getTextContent();
    const pageHits = [];

    for (const item of tc.items) {
      const str = String(item.str ?? '').trim();
      if (!str) continue;
      const transform = item.transform;
      const x = transform?.[4] ?? null;
      const y = transform?.[5] ?? null;
      for (const hit of scanUtmLikeText(str)) {
        if (hit.pattern === 'plain_6_7_digit' && !hit.axis) {
          continue;
        }
        pageHits.push({ ...hit, text: str, x, y });
        totalHits++;
        if (hit.axis) axisHits++;
      }
    }

    if (pageHits.length) {
      pages.push({ pageNum, hits: pageHits });
    }
  }

  return {
    ...spec,
    numPages: pdfDoc.numPages,
    totalHits,
    axisHits,
    pages,
    feasible: axisHits >= 2,
  };
}

const reports = [];
for (const spec of PDFS) {
  try {
    reports.push(await analyzePdf(spec));
  } catch (err) {
    reports.push({ ...spec, error: String(err), totalHits: 0, axisHits: 0, feasible: false, pages: [] });
  }
}

const globalAxisHits = reports.reduce((s, r) => s + (r.axisHits ?? 0), 0);
const n7Status = globalAxisHits === 0 ? 'dropped-no-source' : 'feasible-pending-implementation';

let md = `# UTM grid coordinate label detection (N7 / G-3)\n\n`;
md += `Generated: ${new Date().toISOString().slice(0, 10)}\n\n`;
md += `**G-3 verdict:** \`${n7Status}\` — ${globalAxisHits} explicit E/N-suffixed hits across all PDFs.\n\n`;
md += `| PDF | Pages | Total pattern hits | E/N axis hits | Feasible |\n`;
md += `|-----|-------|-------------------|---------------|----------|\n`;
for (const r of reports) {
  md += `| ${r.key} | ${r.numPages ?? '?'} | ${r.totalHits ?? 0} | ${r.axisHits ?? 0} | ${r.feasible ? 'maybe' : 'no'} |\n`;
}
md += `\n## Per-page matches (E/N suffix only)\n\n`;

for (const r of reports) {
  md += `### ${r.label}\n\n`;
  if (r.error) {
    md += `Error: ${r.error}\n\n`;
    continue;
  }
  const axisPages = (r.pages ?? []).flatMap(p =>
    p.hits.filter(h => h.axis).map(h => ({ pageNum: p.pageNum, ...h }))
  );
  if (!axisPages.length) {
    md += `_No explicit easting/northing axis labels found on this PDF._\n\n`;
    continue;
  }
  for (const h of axisPages.slice(0, 40)) {
    md += `- Page ${h.pageNum}: \`${h.match}\` (${h.axis}, ${h.pattern}) at (${h.x?.toFixed?.(1) ?? '?'}, ${h.y?.toFixed?.(1) ?? '?'})\n`;
  }
  if (axisPages.length > 40) md += `- … and ${axisPages.length - 40} more\n`;
  md += '\n';
}

md += `## Patterns searched\n\n`;
for (const p of PATTERNS) {
  md += `- \`${p.name}\`: \`${p.re.source}\`\n`;
}
md += `\nPlain 6–7 digit numbers are ignored unless paired with E/N (too many false positives).\n`;

mkdirSync('./docs', { recursive: true });
writeFileSync('./docs/utm-label-detection.md', md);

console.log(`N7 feasibility: ${n7Status} (${globalAxisHits} E/N axis hits)`);
console.log(`Wrote docs/utm-label-detection.md`);
for (const r of reports) {
  console.log(
    `  ${r.key}: ${r.axisHits ?? 0} axis hits, ${r.totalHits ?? 0} total` +
      (r.error ? ` ERROR ${r.error}` : '')
  );
}
