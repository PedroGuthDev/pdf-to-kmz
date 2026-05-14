// debug-pdf.mjs — layer-aware Tj/TJ counts + glyph decode
//
// Page selection (works in PowerShell, cmd, bash):
//   node debug-pdf.mjs 1
//   node debug-pdf.mjs --page=1
//   node debug-pdf.mjs -p 1
// PowerShell (environment variable):
//   $env:DEBUG_PAGE = "1"; node debug-pdf.mjs
// cmd.exe:
//   set DEBUG_PAGE=1&& node debug-pdf.mjs
// All pages (verbose):
//   node debug-pdf.mjs --all
// Default single page if omitted: 1 (same as parsePdf scanning each page in order).
import { readFileSync } from 'fs';

// Inline (same logic as parser/ocg-map.js) so this script runs under Node without
// relying on parser/*.js being loaded as ESM vs CJS interop.
const normalizeName = s =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const pdfjsLib = await import('./node_modules/pdfjs-dist/legacy/build/pdf.mjs');
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href;

const data = new Uint8Array(readFileSync('./INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf'));
const pdfDoc = await pdfjsLib.getDocument({ data }).promise;

const config = await pdfDoc.getOptionalContentConfig();
const idToName = {};
for (const [id, group] of config) {
  idToName[id] = group.name;
  idToName[String(id)] = group.name;
}

// Mirror parser/layer-sources.js (inline so Node does not load parser/*.js as CJS).
function isPostLabelSourceLayerName(rawName) {
  const n = normalizeName(rawName);
  if (n === normalizeName('TEXTO') || n === normalizeName('Numero_Poste')) return true;
  if (n === normalizeName('Poste')) return true;
  if (n.includes('moldura') && n.includes('intelig')) return true;
  if (n.startsWith('texto_')) return true;
  return false;
}
function isDistanceSourceLayerName(rawName) {
  return normalizeName(rawName) === normalizeName('Distância_Poste');
}

const OPS = {SAVE:10,RESTORE:11,TRANSFORM:12,BMC:69,BDC:70,EMC:71,PATH:91,
             BT:31,TL:38,Td:40,TD:41,Tm:42,TSTAR:43,Tj:44,TJ:45};

function readMatrix6(a){if(typeof a[0]==='number')return a;if(a[0]!=null&&typeof a[0].length==='number')return a[0];return null;}

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
  if (typeof arg === 'object' && arg !== null) {
    if (typeof arg.unicode === 'number') return String.fromCharCode(arg.unicode);
    if (typeof arg.fontChar === 'string') return arg.fontChar;
  }
  return '';
}

function operatorShowString(f, a) {
  if (f === OPS.Tj || f === OPS.TJ) return stringifyShowArg(a[0]);
  return '';
}

/** 1-based page index: CLI > DEBUG_PAGE > default */
function resolveDebugPageNum(defaultPage = 1) {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--page' || a === '-p') {
      const next = argv[i + 1];
      if (next && /^\d+$/.test(next)) return parseInt(next, 10);
    } else {
      const m = /^--page=(\d+)$/.exec(a);
      if (m) return parseInt(m[1], 10);
    }
  }
  const lone = argv.find(x => /^\d+$/.test(x));
  if (lone) return parseInt(lone, 10);
  if (process.env.DEBUG_PAGE && /^\d+$/.test(String(process.env.DEBUG_PAGE).trim())) {
    return parseInt(String(process.env.DEBUG_PAGE).trim(), 10);
  }
  return defaultPage;
}

const argvGlobal = process.argv.slice(2);
const runAllPages = argvGlobal.includes('--all');

async function debugOnePage(pageNum) {
  const page = await pdfDoc.getPage(pageNum);
  const pH = page.view[3];
  const { fnArray: fn, argsArray: args } = await page.getOperatorList({ intent: 'any' });

  const ls = [], cs = [];
  let ctm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  let tm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, tlm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, leading = 0;

  const postLayerOps = [], distTextOps = [];
  const layerHistogram = {};

  for (let i = 0; i < fn.length; i++) {
    const f = fn[i], a = args[i];
    switch (f) {
      case OPS.SAVE: cs.push({ ...ctm }); break;
      case OPS.RESTORE: if (cs.length > 0) ctm = cs.pop(); break;
      case OPS.TRANSFORM: { const m = readMatrix6(a); if (m) { const [na, nb, nc, nd, ne, nf] = m, { a: oa, b: ob, c: oc, d: od, e: oe, f: of } = ctm; ctm = { a: oa * na + oc * nb, b: ob * na + od * nb, c: oa * nc + oc * nd, d: ob * nc + od * nd, e: oa * ne + oc * nf + oe, f: ob * ne + od * nf + of }; } break; }
      case OPS.BMC: ls.push(null); break;
      case OPS.BDC: { const gid = a?.[1]?.id; const raw = gid != null ? (idToName[gid] ?? idToName[String(gid)] ?? null) : null; ls.push(raw); break; }
      case OPS.EMC: if (ls.length > 0) ls.pop(); break;
      case OPS.BT: tm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; tlm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; break;
      case OPS.TL: leading = a[0]; break;
      case OPS.Tm: { const m = readMatrix6(a); if (m) { const [ma, mb, mc, md, me, mf] = m; tm = { a: ma, b: mb, c: mc, d: md, e: me, f: mf }; tlm = { a: ma, b: mb, c: mc, d: md, e: me, f: mf }; } break;
      case OPS.Td: tlm = { ...tlm, e: tlm.e + a[0], f: tlm.f + a[1] }; tm = { ...tlm }; break;
      case OPS.TD: leading = -a[1]; tlm = { ...tlm, e: tlm.e + a[0], f: tlm.f + a[1] }; tm = { ...tlm }; break;
      case OPS.TSTAR: tlm = { ...tlm, f: tlm.f - leading }; tm = { ...tlm }; break;
      case OPS.Tj:
      case OPS.TJ: {
        const rawLayer = ls.length > 0 ? ls[ls.length - 1] : null;
        const px = tm.e * ctm.a + tm.f * ctm.c + ctm.e;
        const py = tm.e * ctm.b + tm.f * ctm.d + ctm.f;
        const pyFlip = pH - py;
        const decoded = operatorShowString(f, a).trim();
        if (rawLayer) {
          const nk = rawLayer;
          layerHistogram[nk] = (layerHistogram[nk] ?? 0) + 1;
        }
        if (rawLayer && isPostLabelSourceLayerName(rawLayer)) {
          postLayerOps.push({ rawLayer, px: px.toFixed(2), py: py.toFixed(2), pyFlip: pyFlip.toFixed(2), decoded: decoded.slice(0, 40) });
        }
        if (rawLayer && isDistanceSourceLayerName(rawLayer)) distTextOps.push({ px: px.toFixed(2), py: py.toFixed(2), pyFlip: pyFlip.toFixed(2), decoded: decoded.slice(0, 40) });
        break;
      }
    }
  }

  console.log(`\n--- Page ${pageNum} ---`);
  console.log('\nTj/TJ counts by raw OCG layer (top of stack):');
  console.log(Object.entries(layerHistogram).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${v}\t${JSON.stringify(k)}`).join('\n'));

  console.log(`\nPost-label Tj/TJ (TEXTO, Numero_Poste, txt_moldura_*, texto_*): ${postLayerOps.length}`);
  postLayerOps.slice(0, 20).forEach((t, i) => console.log(`  [${i}] layer=${JSON.stringify(t.rawLayer)} px=${t.px} pyFlip=${t.pyFlip}  decoded=${JSON.stringify(t.decoded)}`));

  console.log(`\nDistância_Poste layer text ops: ${distTextOps.length}`);
  distTextOps.slice(0, 8).forEach((t, i) => console.log(`  [${i}] px=${t.px} pyFlip=${t.pyFlip}  ${JSON.stringify(t.decoded)}`));

  const tc = await page.getTextContent();
  console.log(`\ngetTextContent total items: ${tc.items.length}`);

  console.log('\n=== Post-layer op vs nearest getTextContent (first 12) ===');
  for (const top of postLayerOps.slice(0, 12)) {
    const px = parseFloat(top.px);
    const py = pH - parseFloat(top.pyFlip);
    let best = null;
    let bestD = Infinity;
    for (const it of tc.items) {
      if (!it.str) continue;
      const d = Math.hypot(it.transform[4] - px, it.transform[5] - py);
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    }
    console.log(
      `  layer=${JSON.stringify(top.rawLayer)} op=(${top.px},${top.pyFlip}flip) decoded=${JSON.stringify(top.decoded)} → "${best?.str}" Δ=${bestD.toFixed(2)}pt`
    );
  }
}

if (runAllPages) {
  console.log(`\n=== debug-pdf.mjs --all (${pdfDoc.numPages} pages) ===`);
  for (let p = 1; p <= pdfDoc.numPages; p++) await debugOnePage(p);
} else {
  const pageNum = resolveDebugPageNum(1);
  await debugOnePage(pageNum);
}
