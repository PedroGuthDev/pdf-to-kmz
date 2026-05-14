// parser/text-extractor.js
// CTM-correlation-based text layer extractor for pdf.js 5.x.
//
// WHY CTM CORRELATION:
// page.getTextContent({ includeMarkedContent: true }) returns beginMarkedContentProps
// items with id: null for ALL items in this PDF because it uses OCMD (Optional Content
// Membership Dictionary) references. pdf.js 5.x does not resolve OCMD refs to group IDs
// in the text content pipeline. Therefore item.id cannot be used for layer assignment.
//
// The operator list approach DOES work. We walk the operator list to track which OCG
// layer is active when each text show operator fires, record the CTM (e,f) translation
// at that moment, then correlate getTextContent items by matching their transform[4,5]
// position to a recorded CTM position.
//
// Named ESM exports only — no default export, no CommonJS require.

// pdf.js OPS constants verified from src/shared/util.js:
const OPS_SAVE = 10;                  // fn=10  q   — push graphics state
const OPS_RESTORE = 11;              // fn=11  Q   — pop graphics state
const OPS_TRANSFORM = 12;            // fn=12  cm  — concatenate CTM
const OPS_SHOW_TEXT = 44;            // fn=44  Tj — text paint (pdf.js 5.x OPS.showText)
const OPS_SHOW_SPACED_TEXT = 45;     // fn=45  TJ — text paint spaced (pdf.js 5.x OPS.showSpacedText)
const OPS_BEGIN_MARKED = 70;         // fn=70  BDC — begin marked content with OCG id
const OPS_END_MARKED = 71;           // fn=71  EMC — end marked content

/**
 * Extract text items per OCG layer using CTM correlation.
 *
 * @param {import('pdfjs-dist').PDFPageProxy} page
 * @param {Object} idToName  Maps raw OCG ID strings to raw layer name strings.
 * @returns {Promise<Object>}  { [layerName: string]: Array<{ str: string, x: number, y: number }> }
 *   x and y are raw PDF coordinates (flipY NOT applied here — applied in pdf-parser.js).
 */
export async function extractLayerText(page, idToName) {
  // ── STEP 1: Walk operator list to record CTM positions per layer ──────────

  const opList = await page.getOperatorList();
  const { fnArray, argsArray } = opList;

  // CTM stack — initial identity matrix.
  // We only need the translation components (e, f) for position matching,
  // but we must track the full matrix for correct concatenation.
  const ctmStack = [];
  let ctm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  let activeLayer = null;

  // Recorded positions: [{ layer: string, e: number, f: number }]
  const positions = [];

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];

    switch (fn) {
      case OPS_SAVE:
        // Push copy of current CTM onto stack.
        ctmStack.push({ ...ctm });
        break;

      case OPS_RESTORE:
        // Pop CTM from stack.
        if (ctmStack.length > 0) {
          ctm = ctmStack.pop();
        }
        break;

      case OPS_TRANSFORM: {
        // Concatenate new matrix [a,b,c,d,e,f] into current CTM.
        // Full 2D affine concatenation:
        //   newCTM = currentCTM × newMatrix
        // [ a  b  0 ]   [ na nb 0 ]
        // [ c  d  0 ] × [ nc nd 0 ]
        // [ e  f  1 ]   [ ne nf 1 ]
        const [na, nb, nc, nd, ne, nf] = args;
        const prevA = ctm.a, prevB = ctm.b;
        const prevC = ctm.c, prevD = ctm.d;
        const prevE = ctm.e, prevF = ctm.f;

        ctm = {
          a: prevA * na + prevB * nc,
          b: prevA * nb + prevB * nd,
          c: prevC * na + prevD * nc,
          d: prevC * nb + prevD * nd,
          e: prevE * na + prevF * nc + ne,
          f: prevE * nb + prevF * nd + nf,
        };
        break;
      }

      case OPS_BEGIN_MARKED: {
        // args: [tag, { id: groupId }]
        if (args && args[1] && args[1].id !== undefined && args[1].id !== null) {
          const rawName = idToName[args[1].id];
          if (rawName !== undefined) {
            activeLayer = rawName;
          }
        }
        break;
      }

      case OPS_END_MARKED:
        activeLayer = null;
        break;

      case OPS_SHOW_TEXT:
      case OPS_SHOW_SPACED_TEXT:
        // Record CTM translation when a text paint op fires in an active layer.
        if (activeLayer !== null) {
          positions.push({ layer: activeLayer, e: ctm.e, f: ctm.f });
        }
        break;
    }
  }

  // ── STEP 2: Walk getTextContent() items and match by position ─────────────

  const textContent = await page.getTextContent();
  const byLayer = {};

  for (const item of textContent.items) {
    if (item.str === undefined) continue; // skip non-text items (marks, etc.)

    const tx = item.transform[4];
    const ty = item.transform[5];

    // Find a recorded position within 0.5 PDF points (float tolerance).
    const match = positions.find(
      pos => Math.abs(pos.e - tx) < 0.5 && Math.abs(pos.f - ty) < 0.5
    );

    if (match) {
      if (!byLayer[match.layer]) {
        byLayer[match.layer] = [];
      }
      // x and y are raw PDF coords; flipY applied by pdf-parser.js.
      byLayer[match.layer].push({ str: item.str, x: tx, y: ty });
    }
  }

  return byLayer;
}
