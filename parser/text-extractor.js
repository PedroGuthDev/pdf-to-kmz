// parser/text-extractor.js
// Layer-filtered text extractor for pdf.js 5.x.
//
// WHY TEXT MATRIX + CTM CORRELATION:
// getTextContent() beginMarkedContentProps items have id:null in this PDF (OCMD issue).
// Fix: walk the operator list tracking both the CTM (cm=12) AND the text matrix
// (Tm=42, Td=40, TD=41, T*=43, BT=31).  Compute each showText origin in PAGE COORDS,
// then correlate with getTextContent items by matching their transform[4,5].
//
// Named ESM exports only — no default export, no CommonJS require.

// pdf.js OPS constants (verified from pdfjs-dist/build/pdf.mjs ~line 240):
const OPS_SAVE              = 10;  // q
const OPS_RESTORE           = 11;  // Q
const OPS_TRANSFORM         = 12;  // cm  — concatenate CTM
const OPS_BEGIN_TEXT        = 31;  // BT  — reset text matrix
const OPS_SET_LEADING       = 38;  // TL  — set text leading
const OPS_MOVE_TEXT         = 40;  // Td  — advance line by (tx, ty)
const OPS_LEADING_MOVE_TEXT = 41;  // TD  — same as Td + set leading
const OPS_SET_TEXT_MATRIX   = 42;  // Tm  — set text matrix
const OPS_NEXT_LINE         = 43;  // T*  — advance by (0, -leading)
const OPS_SHOW_TEXT         = 44;  // Tj
const OPS_SHOW_SPACED_TEXT  = 45;  // TJ
const OPS_BEGIN_MARKED_CONTENT = 69;  // BMC — anonymous marked content (no OCG ID)
const OPS_BEGIN_MARKED      = 70;     // BDC — marked content with properties (carries OCG ID)
const OPS_END_MARKED        = 71;     // EMC — closes both BMC and BDC

// Apply right-multiply (column-vector convention) to a 2D affine matrix.
// new_CTM = old_CTM × M  where M = [[na,nc,ne],[nb,nd,nf],[0,0,1]]
// Correct for pdf.js / Canvas 2D column-vector format.
function matMul(old, na, nb, nc, nd, ne, nf) {
  return {
    a: old.a * na + old.c * nb,
    b: old.b * na + old.d * nb,
    c: old.a * nc + old.c * nd,
    d: old.b * nc + old.d * nd,
    e: old.a * ne + old.c * nf + old.e,
    f: old.b * ne + old.d * nf + old.f,
  };
}

// Read 6 matrix values from operator args.
// pdf.js 5.x may pack matrix args as a single Array/Float32Array in args[0]
// rather than 6 individual numbers. Handles both formats transparently.
let _diagMatrixFormat = null;
function readMatrix6(args) {
  if (typeof args[0] === 'number') return args;
  if (args[0] != null && typeof args[0].length === 'number') {
    if (_diagMatrixFormat !== 'packed') {
      _diagMatrixFormat = 'packed';
      console.debug('[textExtractor] packed matrix args detected — type:', args[0]?.constructor?.name, 'length:', args[0]?.length);
    }
    return args[0];
  }
  return null;
}

/**
 * Extract text items per OCG layer.
 *
 * @param {import('pdfjs-dist').PDFPageProxy} page
 * @param {Object} idToName  Maps raw OCG ID strings to raw layer name strings.
 * @returns {Promise<Object>}  { [layerName]: Array<{str, x, y}> }  raw PDF coords.
 */
export async function extractLayerText(page, idToName) {
  // ── STEP 1: Walk operator list ─────────────────────────────────────────────

  const opList = await page.getOperatorList();
  const { fnArray, argsArray } = opList;

  const ctmStack = [];
  let ctm     = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  let tm      = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; // text matrix
  let tlm     = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; // text line matrix
  let leading = 0;

  // Layer stack — replaces single activeLayer variable (fix for CR-01 / WR-01).
  // PDFs nest BMC (fn=69, anonymous) inside BDC (fn=70, OCG) operators for layout/artifacts.
  // Each BMC/BDC pushes to the stack; each EMC (fn=71) pops exactly one entry.
  // This preserves the outer BDC layer name when an inner BMC's EMC fires.
  const layerStack = [];

  // positions[i] = { layer, px, py } — text origin in PDF page coords.
  const positions = [];

  for (let i = 0; i < fnArray.length; i++) {
    const fn   = fnArray[i];
    const args = argsArray[i];

    switch (fn) {
      case OPS_SAVE:
        ctmStack.push({ ...ctm });
        break;

      case OPS_RESTORE:
        if (ctmStack.length > 0) ctm = ctmStack.pop();
        break;

      case OPS_TRANSFORM: {
        const m = readMatrix6(args);
        if (m) ctm = matMul(ctm, m[0], m[1], m[2], m[3], m[4], m[5]);
        break;
      }

      case OPS_BEGIN_MARKED_CONTENT:
        // BMC: anonymous marked content — push null so EMC pops correctly.
        layerStack.push(null);
        break;

      case OPS_BEGIN_MARKED:
        // BDC: push the OCG layer name (or null if id not found in map).
        if (args && args[1] && args[1].id != null) {
          const rawName = idToName[args[1].id];
          layerStack.push(rawName !== undefined ? rawName : null);
        } else {
          layerStack.push(null);
        }
        break;

      case OPS_END_MARKED:
        // EMC: pop one entry regardless of whether it was pushed by BMC or BDC.
        if (layerStack.length > 0) layerStack.pop();
        break;

      case OPS_BEGIN_TEXT:
        // BT: reset both text matrix and line matrix to identity.
        tm  = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        tlm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        break;

      case OPS_SET_LEADING:
        // TL tl: set text leading directly (positive value = descent per line).
        // Unlike TD which sets leading = -ty, TL sets leading = args[0] directly.
        leading = args[0];
        break;

      case OPS_SET_TEXT_MATRIX: {
        // Tm a b c d e f: replace text matrix AND line matrix.
        const m = readMatrix6(args);
        if (m) {
          const [ma, mb, mc, md, me, mf] = m;
          tm  = { a: ma, b: mb, c: mc, d: md, e: me, f: mf };
          tlm = { a: ma, b: mb, c: mc, d: md, e: me, f: mf };
        }
        break;
      }

      case OPS_MOVE_TEXT: {
        // Td tx ty: new_tlm = old_tlm × translate(tx, ty)
        // translate = [1,0,0,1,tx,ty] → only e,f change: e+=tx, f+=ty
        tlm = { ...tlm, e: tlm.e + args[0], f: tlm.f + args[1] };
        tm  = { ...tlm };
        break;
      }

      case OPS_LEADING_MOVE_TEXT: {
        // TD tx ty: same as Td but also sets leading = -ty.
        leading = -args[1];
        tlm = { ...tlm, e: tlm.e + args[0], f: tlm.f + args[1] };
        tm  = { ...tlm };
        break;
      }

      case OPS_NEXT_LINE: {
        // T*: Td(0, -leading)
        tlm = { ...tlm, f: tlm.f - leading };
        tm  = { ...tlm };
        break;
      }

      case OPS_SHOW_TEXT:
      case OPS_SHOW_SPACED_TEXT: {
        const activeLayer = layerStack.length > 0 ? layerStack[layerStack.length - 1] : null;
        if (activeLayer !== null) {
          // Text origin in page coords: apply CTM to text matrix origin (tm.e, tm.f).
          // row-vector: pageX = tm.e * ctm.a + tm.f * ctm.c + ctm.e
          positions.push({
            layer: activeLayer,
            px: tm.e * ctm.a + tm.f * ctm.c + ctm.e,
            py: tm.e * ctm.b + tm.f * ctm.d + ctm.f,
          });
        }
        break;
      }
    }
  }

  // ── STEP 2: Correlate with getTextContent() by position ───────────────────

  // DEBUG: count positions per layer and show first position per layer
  const layerCounts = {};
  for (const p of positions) {
    if (!layerCounts[p.layer]) layerCounts[p.layer] = { n: 0, first: p };
    layerCounts[p.layer].n++;
  }
  if (Object.keys(layerCounts).length > 0) {
    console.debug('[textExtractor] positions by layer:', JSON.stringify(Object.fromEntries(Object.entries(layerCounts).map(([k,v])=>[k, {n:v.n, px:v.first.px?.toFixed(1), py:v.first.py?.toFixed(1)}]))));
  }

  const textContent = await page.getTextContent();
  // DEBUG: show first 3 getTextContent item positions
  const items = textContent.items.filter(it => it.str != null).slice(0, 3);
  if (items.length > 0) console.debug('[textExtractor] first 3 textContent item positions:', items.map(it=>({str:it.str, t4:it.transform[4]?.toFixed(1), t5:it.transform[5]?.toFixed(1)})));
  const byLayer = {};

  for (const item of textContent.items) {
    if (item.str === undefined) continue;

    const tx = item.transform[4];
    const ty = item.transform[5];

    // 1.0 pt tolerance — covers floating-point drift between the two pipelines.
    const match = positions.find(
      pos => Math.abs(pos.px - tx) < 1.0 && Math.abs(pos.py - ty) < 1.0
    );

    if (match) {
      if (!byLayer[match.layer]) byLayer[match.layer] = [];
      byLayer[match.layer].push({ str: item.str, x: tx, y: ty });
    }
  }

  return byLayer;
}
