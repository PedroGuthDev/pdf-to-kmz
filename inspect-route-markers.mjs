// inspect-route-markers.mjs — run against the PDF in repo root to see why circle↔digit "inside" fails.
//
// Usage:
//   node inspect-route-markers.mjs
//   node inspect-route-markers.mjs ".\my.pdf" 1
//   node inspect-route-markers.mjs --all
//
// Uses pdf.js from node_modules (same as debug-pdf.mjs) + real parser/graphics-extractor.js circles.

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { isRouteSequentialNumberLayerName } from './parser/layer-sources.js';

const pdfjsLib = await import('./node_modules/pdfjs-dist/legacy/build/pdf.mjs');
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
  import.meta.url
).href;

const { extractLayerGraphics } = await import('./parser/graphics-extractor.js');

const OPS = {
  SAVE: 10,
  RESTORE: 11,
  TRANSFORM: 12,
  BMC: 69,
  BDC: 70,
  EMC: 71,
  PATH: 91,
  BT: 31,
  TL: 38,
  Td: 40,
  TD: 41,
  Tm: 42,
  TSTAR: 43,
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

function resolvePdfPath() {
  const argv = process.argv.slice(2).filter(a => !a.startsWith('-') && !/^\d+$/.test(a));
  if (argv[0] && existsSync(argv[0])) return argv[0];
  const root = '.';
  try {
    const pdfs = readdirSync(root).filter(f => f.toLowerCase().endsWith('.pdf'));
    if (pdfs.length) return join(root, pdfs[0]);
  } catch {
    /* ignore */
  }
  const fallback = './INFOVIAS_PJC INTERNET_Palhoça_RUA VALMOR FRANCISCO_v1.pdf';
  if (existsSync(fallback)) return fallback;
  return null;
}

function resolvePageNums(numPages, argv) {
  if (argv.includes('--all')) return [...Array(numPages).keys()].map(i => i + 1);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--page' || a === '-p') {
      const n = parseInt(argv[i + 1], 10);
      if (n >= 1 && n <= numPages) return [n];
    }
    const m = /^--page=(\d+)$/.exec(a);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= numPages) return [n];
    }
  }
  const lone = argv.find(x => /^\d+$/.test(x));
  if (lone) {
    const n = parseInt(lone, 10);
    if (n >= 1 && n <= numPages) return [n];
  }
  return [1];
}

/** Whole-item 1–3 digit Tj/TJ on any OCG layer (diagnostic: see real layer names). */
function collectAllWholeDigitTextOps(page, idToName, pageHeight) {
  return new Promise(resolve => {
    page.getOperatorList({ intent: 'any' }).then(opList => {
      const fn = opList.fnArray;
      const args = opList.argsArray;
      const ls = [];
      let ctm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
      const cs = [];
      let tm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
      let tlm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
      let leading = 0;
      const out = [];

      for (let i = 0; i < fn.length; i++) {
        const f = fn[i];
        const a = args[i];
        switch (f) {
          case OPS.SAVE:
            cs.push({ ...ctm });
            break;
          case OPS.RESTORE:
            if (cs.length > 0) ctm = cs.pop();
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
            const raw = gid != null ? idToName[gid] ?? idToName[String(gid)] ?? null : null;
            ls.push(raw);
            break;
          }
          case OPS.EMC:
            if (ls.length > 0) ls.pop();
            break;
          case OPS.BT:
            tm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
            tlm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
            break;
          case OPS.TL:
            leading = a[0];
            break;
          case OPS.Tm: {
            const m = readMatrix6(a);
            if (m) {
              const [ma, mb, mc, md, me, mf] = m;
              tm = { a: ma, b: mb, c: mc, d: md, e: me, f: mf };
              tlm = { ...tm };
            }
            break;
          }
          case OPS.Td:
            tlm = { ...tlm, e: tlm.e + a[0], f: tlm.f + a[1] };
            tm = { ...tlm };
            break;
          case OPS.TD:
            leading = -a[1];
            tlm = { ...tlm, e: tlm.e + a[0], f: tlm.f + a[1] };
            tm = { ...tlm };
            break;
          case OPS.TSTAR:
            tlm = { ...tlm, f: tlm.f - leading };
            tm = { ...tlm };
            break;
          case OPS.Tj:
          case OPS.TJ: {
            const rawLayer = ls.length > 0 ? ls[ls.length - 1] : null;
            const px = tm.e * ctm.a + tm.f * ctm.c + ctm.e;
            const py = tm.e * ctm.b + tm.f * ctm.d + ctm.f;
            const yFlip = pageHeight - py;
            const decoded = operatorShowString(f, a).trim();
            if (rawLayer && /^\d{1,3}$/.test(decoded)) {
              const n = parseInt(decoded, 10);
              if (n >= 1) {
                out.push({
                  rawLayer,
                  x: px,
                  y: yFlip,
                  str: decoded,
                });
              }
            }
            break;
          }
          default:
            break;
        }
      }
      resolve(out);
    });
  });
}

function maskConductorLikeSpecs(s) {
  return String(s)
    .replace(/\b\d{1,3}\s*-\s*\d{1,3}\b/g, ' ')
    .replace(/\b\d{1,3}\s*[xX]\s*\d{1,4}\b/g, ' ');
}

async function inspectPage(pdfDoc, pageNum, idToName) {
  const page = await pdfDoc.getPage(pageNum);
  const pageHeight = page.view[3];

  const gfx = await extractLayerGraphics(page, idToName);
  const circlesRaw = gfx.circles.map(c => ({
    x: c.x,
    y: pageHeight - c.y,
  }));

  const allDigitOps = await collectAllWholeDigitTextOps(page, idToName, pageHeight);
  const routeOps = allDigitOps.filter(t => isRouteSequentialNumberLayerName(t.rawLayer));

  const byLayer = new Map();
  for (const t of allDigitOps) {
    const k = t.rawLayer ?? '(null)';
    byLayer.set(k, (byLayer.get(k) ?? 0) + 1);
  }

  const tc = await page.getTextContent();
  const gettextDigits = [];
  const gettextMaskedFirst = [];
  const reMasked = /(?<!\d)(\d{1,3})(?!\d)/;
  for (const it of tc.items) {
    if (it.str == null) continue;
    const s = String(it.str).trim();
    const tx = it.transform[4];
    const w = typeof it.width === 'number' && it.width > 0 ? it.width : 0;
    const xPos = w > 0 ? tx + w * 0.5 : tx;
    const yFlip = pageHeight - it.transform[5];
    if (/^\d{1,3}$/.test(s) && parseInt(s, 10) >= 1) {
      gettextDigits.push({ str: s, x: xPos, y: yFlip });
    }
    const masked = maskConductorLikeSpecs(s);
    const m = reMasked.exec(masked);
    if (m && parseInt(m[1], 10) >= 1) {
      gettextMaskedFirst.push({ str: m[1], x: xPos, y: yFlip, raw: s.slice(0, 32) });
    }
  }

  const TH = 54;

  console.log(`\n========== Page ${pageNum} ==========`);
  console.log(`pageHeight=${pageHeight}`);
  console.log(`circles (Numero_Poste gfx, flipY)=${circlesRaw.length}`);
  console.log(`operator-list whole-item digit Tj/TJ (any OCG)=${allDigitOps.length}`);
  console.log(`  by raw layer name:`);
  console.log(
    [...byLayer.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `    ${v}\t${JSON.stringify(k)}`)
      .join('\n')
  );
  console.log(`operator-list route digits (TEXTO|Numero_Poste only)=${routeOps.length}`);
  console.log(`getTextContent whole-item 1–3 digit items=${gettextDigits.length}`);
  console.log(`getTextContent masked first isolated digit=${gettextMaskedFirst.length}`);

  if (circlesRaw.length) {
    console.log('\nFirst 8 circle centres (flipY space):');
    circlesRaw.slice(0, 8).forEach((c, i) => console.log(`  [${i}] (${c.x.toFixed(1)}, ${c.y.toFixed(1)})`));
  }

  if (routeOps.length) {
    console.log('\nFirst 15 route-digit Tj/TJ (flipY, operator walk):');
    routeOps.slice(0, 15).forEach((t, i) =>
      console.log(`  [${i}] layer=${JSON.stringify(t.rawLayer)} "${t.str}" (${t.x.toFixed(1)}, ${t.y.toFixed(1)})`)
    );
  } else if (allDigitOps.length) {
    console.log(
      `\n(no TEXTO|Numero_Poste whole-digit Tj/TJ; ${allDigitOps.length} whole-digit ops on other layers — see histogram)`
    );
  } else {
    console.log('\n(no whole-item 1–3 digit Tj/TJ on any OCG layer in operator list)');
  }

  if (gettextDigits.length) {
    console.log('\nFirst 12 getTextContent digit items (flipY, mid-x):');
    gettextDigits.slice(0, 12).forEach((t, i) =>
      console.log(`  [${i}] "${t.str}" (${t.x.toFixed(1)}, ${t.y.toFixed(1)})`)
    );
  }

  console.log(`\n--- Nearest route op → each circle (threshold ${TH} pt) ---`);
  let hitsRoute = 0;
  for (let ci = 0; ci < Math.min(circlesRaw.length, 40); ci++) {
    const c = circlesRaw[ci];
    let best = null;
    let bestD = Infinity;
    for (const t of routeOps) {
      const d = Math.hypot(t.x - c.x, t.y - c.y);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    const ok = bestD <= TH;
    if (ok) hitsRoute++;
    console.log(
      `  circle[${ci}] (${c.x.toFixed(0)},${c.y.toFixed(0)}) → nearest routeOp: ` +
        (best ? `${JSON.stringify(best.rawLayer)} "${best.str}" Δ=${bestD.toFixed(1)} ${ok ? 'OK' : 'TOO_FAR'}` : 'none')
    );
  }

  console.log(`\n--- Nearest gettext digit → each circle (threshold ${TH} pt) ---`);
  let hitsGt = 0;
  for (let ci = 0; ci < Math.min(circlesRaw.length, 40); ci++) {
    const c = circlesRaw[ci];
    let bestD = Infinity;
    let bestS = null;
    for (const t of gettextDigits) {
      const d = Math.hypot(t.x - c.x, t.y - c.y);
      if (d < bestD) {
        bestD = d;
        bestS = t.str;
      }
    }
    const ok = bestD <= TH;
    if (ok) hitsGt++;
    console.log(
      `  circle[${ci}] → nearest gettext "${bestS ?? '?'}" Δ=${bestD === Infinity ? '∞' : bestD.toFixed(1)} ${ok ? 'OK' : 'TOO_FAR'}`
    );
  }

  console.log(`\n--- Nearest masked-first gettext → each circle (threshold ${TH} pt) ---`);
  let hitsMask = 0;
  for (let ci = 0; ci < Math.min(circlesRaw.length, 40); ci++) {
    const c = circlesRaw[ci];
    let bestD = Infinity;
    let bestS = null;
    for (const t of gettextMaskedFirst) {
      const d = Math.hypot(t.x - c.x, t.y - c.y);
      if (d < bestD) {
        bestD = d;
        bestS = t.str;
      }
    }
    const ok = bestD <= TH;
    if (ok) hitsMask++;
    console.log(
      `  circle[${ci}] → nearest masked "${bestS ?? '?'}" Δ=${bestD === Infinity ? '∞' : bestD.toFixed(1)} ${ok ? 'OK' : 'TOO_FAR'}`
    );
  }

  console.log(
    `\nSummary (first ${Math.min(40, circlesRaw.length)} circles): routeOp≤${TH}: ${hitsRoute}, gettext whole≤${TH}: ${hitsGt}, gettext masked≤${TH}: ${hitsMask}`
  );
}

const pdfPath = resolvePdfPath();
if (!pdfPath) {
  console.error('No PDF found. Put a .pdf in the repo root or pass path: node inspect-route-markers.mjs ./file.pdf');
  process.exit(1);
}

console.log('PDF:', pdfPath);
const data = new Uint8Array(readFileSync(pdfPath));
const pdfDoc = await pdfjsLib.getDocument({ data }).promise;

const config = await pdfDoc.getOptionalContentConfig();
const idToName = {};
for (const [id, group] of config) {
  idToName[id] = group.name;
  idToName[String(id)] = group.name;
}

console.log('\nOCG layers (sample):');
console.log(
  [...new Set(Object.values(idToName))].slice(0, 25).map(n => `  ${JSON.stringify(n)}`).join('\n')
);

const argv = process.argv.slice(2);
const pages = resolvePageNums(pdfDoc.numPages, argv);
for (const p of pages) {
  await inspectPage(pdfDoc, p, idToName);
}
