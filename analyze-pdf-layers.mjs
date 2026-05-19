// analyze-pdf-layers.mjs — deep OCG + per-page content inventory for example PDFs.
// Usage: node analyze-pdf-layers.mjs [--json]
import { readFileSync, writeFileSync } from 'fs';
import { buildOcgMap, validateLayers, normalizeName } from './parser/ocg-map.js';
import {
  isPostLabelSourceLayerName,
  isDistanceSourceLayerName,
  isCircleCentroidLayerName,
  isPosteGraphicsLayerName,
  isUtmGridLayerName,
  isViewportRectLayerName,
} from './parser/layer-sources.js';
import { extractLayerText } from './parser/text-extractor.js';
import { extractLayerGraphics } from './parser/graphics-extractor.js';

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

const pdfjsLib = await import('./node_modules/pdfjs-dist/legacy/build/pdf.mjs');
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
  import.meta.url
).href;

const OPS = {
  SAVE: 10,
  RESTORE: 11,
  TRANSFORM: 12,
  BMC: 69,
  BDC: 70,
  EMC: 71,
  PATH: 91,
  BT: 31,
  Tj: 44,
  TJ: 45,
};

function readMatrix6(a) {
  if (typeof a[0] === 'number') return a;
  if (a[0] != null && typeof a[0].length === 'number') return a[0];
  return null;
}

function stringifyShowArg(arg) {
  if (typeof arg === 'string') return arg;
  if (arg == null) return '';
  if (Array.isArray(arg)) {
    let out = '';
    for (const el of arg) {
      if (typeof el === 'string') out += el;
      else if (typeof el === 'number') continue;
      else if (el && typeof el === 'object') {
        if (typeof el.unicode === 'number') out += String.fromCharCode(el.unicode);
        else if (typeof el.fontChar === 'string') out += el.fontChar;
        else if (typeof el.char === 'string') out += el.char;
      }
    }
    return out;
  }
  return '';
}

/** Operator-list walk: Tj/TJ + constructPath counts per OCG layer. */
async function operatorStats(page, idToName) {
  const { fnArray: fn, argsArray: args } = await page.getOperatorList({ intent: 'any' });
  const textByLayer = {};
  const pathByLayer = {};
  const wholeDigitByLayer = {};
  const ls = [];
  const cs = [];
  let ctm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  let tm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

  for (let i = 0; i < fn.length; i++) {
    const f = fn[i];
    const a = args[i];
    switch (f) {
      case OPS.SAVE:
        cs.push({ ...ctm });
        break;
      case OPS.RESTORE:
        if (cs.length) ctm = cs.pop();
        break;
      case OPS.TRANSFORM: {
        const m = readMatrix6(a);
        if (m) {
          const [na, nb, nc, nd, ne, nf] = m;
          const { a: oa, b: ob, c: oc, d: od, e: oe, f: of } = ctm;
          ctm = {
            a: oa * na + oc * nb,
            b: ob * na + od * nb,
            c: oa * nc + oc * nd,
            d: ob * nc + od * nd,
            e: oa * ne + oc * nf + oe,
            f: ob * ne + od * nf + of,
          };
        }
        break;
      }
      case OPS.BMC:
        ls.push(null);
        break;
      case OPS.BDC: {
        const gid = a?.[1]?.id;
        const raw = gid != null ? (idToName[gid] ?? idToName[String(gid)] ?? '(unknown)') : null;
        ls.push(raw);
        break;
      }
      case OPS.EMC:
        if (ls.length) ls.pop();
        break;
      case OPS.BT:
        tm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        break;
      case OPS.Tj:
      case OPS.TJ: {
        const layer = ls.length ? ls[ls.length - 1] : '(no ocg)';
        textByLayer[layer] = (textByLayer[layer] ?? 0) + 1;
        const decoded = stringifyShowArg(a[0]).trim();
        if (/^\d{1,3}$/.test(decoded)) {
          wholeDigitByLayer[layer] = (wholeDigitByLayer[layer] ?? 0) + 1;
        }
        break;
      }
      case OPS.PATH: {
        const layer = ls.length ? ls[ls.length - 1] : '(no ocg)';
        pathByLayer[layer] = (pathByLayer[layer] ?? 0) + 1;
        break;
      }
    }
  }
  return { textByLayer, pathByLayer, wholeDigitByLayer };
}

function classifyLayer(name) {
  const roles = [];
  if (isCircleCentroidLayerName(name)) roles.push('post_circle_geometry');
  if (isPosteGraphicsLayerName(name)) roles.push('pole_symbol_graphics');
  if (isPostLabelSourceLayerName(name)) roles.push('post_label_text');
  if (isDistanceSourceLayerName(name)) roles.push('inter_post_distance_text');
  if (normalizeName(name) === normalizeName('Cabo Projetado')) roles.push('cable_route');
  if (isUtmGridLayerName(name)) roles.push('utm_grid_calibration');
  if (isViewportRectLayerName(name)) roles.push('viewport_overview_rect');
  if (roles.length === 0) roles.push('other');
  return roles;
}

function sanitizeForJson(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/[\u0000-\u001f\u007f-\u009f]/g, '?').slice(0, 80);
}

function summarizeTextSamples(items, max = 5) {
  return items
    .map(it => sanitizeForJson(it.str?.trim()))
    .filter(Boolean)
    .slice(0, max);
}

async function analyzePdf({ key, label, path }) {
  const data = new Uint8Array(readFileSync(path));
  const pdfDoc = await pdfjsLib.getDocument({
    data,
    standardFontDataUrl: new URL('./node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
  }).promise;

  const { idToName, allNames } = await buildOcgMap(pdfDoc);
  const validation = validateLayers(allNames);

  const layerCatalog = allNames.map(name => ({
    name,
    normalized: normalizeName(name),
    roles: classifyLayer(name),
  }));

  const pages = [];
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const [x0, y0, x1, y1] = page.view;
    const w = x1 - x0;
    const h = y1 - y0;

    const opStats = await operatorStats(page, idToName);
    const textByLayer = await extractLayerText(page, idToName);
    const gfx = await extractLayerGraphics(page, idToName);

    const textSummary = {};
    for (const [ln, items] of Object.entries(textByLayer)) {
      textSummary[ln] = {
        count: items.length,
        samples: summarizeTextSamples(items),
        wholeDigits: items.filter(it => /^\d{1,3}$/.test(String(it.str).trim())).length,
      };
    }

    const pathCounts = {};
    for (const [ln, paths] of Object.entries(gfx.byLayer ?? {})) {
      pathCounts[ln] = paths.length;
    }

    pages.push({
      pageNum,
      size: { w: Math.round(w), h: Math.round(h) },
      operatorTextOps: opStats.textByLayer,
      operatorPathOps: opStats.pathByLayer,
      operatorWholeDigitOps: opStats.wholeDigitByLayer,
      extractedText: textSummary,
      circles: {
        named: gfx.namedLayerCircles?.length ?? 0,
        layer0: gfx.layer0Circles?.length ?? 0,
        merged: gfx.circles?.length ?? 0,
        posteSymbols: gfx.posteSymbols?.length ?? 0,
      },
      cablePathBatches: gfx.cablePaths?.length ?? 0,
      pathBatchesByLayer: pathCounts,
    });
  }

  return {
    key,
    label,
    path,
    numPages: pdfDoc.numPages,
    fileBytes: data.byteLength,
    validation,
    layerCatalog,
    layerCount: allNames.length,
    pages,
  };
}

const reports = [];
for (const spec of PDFS) {
  reports.push(await analyzePdf(spec));
}

const outPath = './docs/pdf-layer-analysis-data.json';
try {
  writeFileSync(outPath, JSON.stringify(reports, null, 2));
} catch {
  /* docs/ may not exist yet */
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(reports, null, 2));
} else {
  for (const r of reports) {
    console.log(`\n${'='.repeat(72)}\n${r.label} (${r.path})\n${'='.repeat(72)}`);
    console.log(`Pages: ${r.numPages}  Layers: ${r.layerCount}  Valid required: ${r.validation.valid}`);
    if (!r.validation.valid) console.log(`Missing required: ${r.validation.missing.join(', ')}`);
    console.log('\nOCG catalog:');
    for (const L of r.layerCatalog) {
      console.log(`  - ${JSON.stringify(L.name)}  [${L.roles.join(', ')}]`);
    }
    for (const p of r.pages) {
      const circ = p.circles;
      if (circ.merged === 0 && circ.posteSymbols === 0 && !Object.keys(p.extractedText).length) continue;
      console.log(`\n  Page ${p.pageNum} (${p.size.w}×${p.size.h} pt) circles: named=${circ.named} layer0=${circ.layer0} poste=${circ.posteSymbols} cable=${p.cablePathBatches}`);
      const activeLayers = Object.entries(p.extractedText).filter(([, v]) => v.count > 0);
      if (activeLayers.length) {
        console.log('    Text layers:');
        for (const [ln, v] of activeLayers) {
          console.log(`      ${JSON.stringify(ln)}: ${v.count} items, wholeDigits=${v.wholeDigits}, samples=${JSON.stringify(v.samples)}`);
        }
      }
      const digits = Object.entries(p.operatorWholeDigitOps).filter(([, n]) => n > 0);
      if (digits.length) {
        console.log(`    Operator whole-digit Tj/TJ: ${digits.map(([k, n]) => `${JSON.stringify(k)}=${n}`).join(', ')}`);
      }
    }
  }
  console.log(`\n(JSON written to ${outPath})`);
}
