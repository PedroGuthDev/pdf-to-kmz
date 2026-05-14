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
const OPS_MOVE_TEXT         = 40;  // Td  — advance line by (tx, ty)
const OPS_LEADING_MOVE_TEXT = 41;  // TD  — same as Td + set leading
const OPS_SET_TEXT_MATRIX   = 42;  // Tm  — set text matrix
const OPS_NEXT_LINE         = 43;  // T*  — advance by (0, -leading)
const OPS_SHOW_TEXT         = 44;  // Tj
const OPS_SHOW_SPACED_TEXT  = 45;  // TJ
const OPS_BEGIN_MARKED      = 70;  // BDC
const OPS_END_MARKED        = 71;  // EMC

// Helper: apply right-multiply (row-vector convention) to a 2D affine matrix.
// new = old × [na,nb,nc,nd,ne,nf]
function matMul(old, na, nb, nc, nd, ne, nf) {
  return {
    a: old.a * na + old.b * nc,
    b: old.a * nb + old.b * nd,
    c: old.c * na + old.d * nc,
    d: old.c * nb + old.d * nd,
    e: old.e * na + old.f * nc + ne,
    f: old.e * nb + old.f * nd + nf,
  };
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
  let activeLayer = null;

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

      case OPS_TRANSFORM:
        ctm = matMul(ctm, args[0], args[1], args[2], args[3], args[4], args[5]);
        break;

      case OPS_BEGIN_MARKED:
        if (args && args[1] && args[1].id != null) {
          const rawName = idToName[args[1].id];
          if (rawName !== undefined) activeLayer = rawName;
        }
        break;

      case OPS_END_MARKED:
        activeLayer = null;
        break;

      case OPS_BEGIN_TEXT:
        // BT: reset both text matrix and line matrix to identity.
        tm  = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        tlm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        break;

      case OPS_SET_TEXT_MATRIX: {
        // Tm a b c d e f: replace text matrix AND line matrix.
        const [ma, mb, mc, md, me, mf] = args;
        tm  = { a: ma, b: mb, c: mc, d: md, e: me, f: mf };
        tlm = { a: ma, b: mb, c: mc, d: md, e: me, f: mf };
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
      case OPS_SHOW_SPACED_TEXT:
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
