// parser/post-positioning-n3.js
// Double-pass N3 coordinate calibration for multi-sheet or single-sheet routes.
// Extracts highly complex geometry post-processing from top-level parsePdf (CR-05).
//
// Named ESM exports only — no default export, no CommonJS require.

import {
  assignPostPositionsFromPosteSymbols,
  assignPolesGloballyByLabels,
} from "./post-positioning.js";
import {
  applyBifurcationJunctionLabelRehome,
  applyJumpbackDistanceCleanup,
  associateDistancesRich,
} from "./distance-associator.js";
import { prefillGapDistancesForPolePlacement } from "./geo/label-lsq-calibrator.js";
import { buildCablesByPage } from "./cable-builder.js";

/**
 * Calibrate post coordinates for multi-sheet or single-sheet routes.
 *
 * @param {Array} posts
 * @param {object} options
 * @returns {Array} calibrated posts
 */
export function calibrateMultiSheetPostCoordinates(posts, {
  allPosteRaw,
  allCablePaths,
  allDistItems,
  distances,
  perPageScale,
  overviewScale,
  warnings,
  multiSheetRoute
}) {
  if (multiSheetRoute) {
    // Capture pass-1 anchor positions + distances BEFORE N3 mutates them,
    // so the pass-2 splice can decide whether to keep pass-1's value.
    const pass1Snapshot = new Map();
    for (const p of posts) {
      pass1Snapshot.set(p.number, {
        x: p.anchorX ?? p.x,
        y: p.anchorY ?? p.y,
        pageNum: p.pageNum ?? null,
      });
    }

    if (process.env?.PP_DBG === "1") {
      console.error(`[PP_DBG] PRE-N3#1 numbers=[${posts.map(p => p.number).join(",")}]`);
    }
    assignPolesGloballyByLabels(
      posts,
      allPosteRaw,
      allCablePaths,
      distances,
      warnings,
      {
        postByNum: new Map(posts.map((p) => [p.number, p])),
        perPageScale,
      },
    );

    if (process.env?.PP_DBG === "1") {
      console.error(`[PP_DBG] POST-N3#1 numbers=[${posts.map(p => p.number).join(",")}]`);
    }
    // D-N3-PASS2: Re-associate distances and re-run N3 once more so the distance
    // map reflects the post-N3 positions (not the pre-N3 Numero_Poste anchors).
    // On routes like João Born where N3 moves tap-detected posts onto the cable,
    // the second pass converges to label-consistent positions that let
    // refinePageOriginsByLabelLsq succeed (browser pipeline parity with the harness
    // PARSE DEBUG flow — see .planning/debug/joao-born-coords-off.md sessions 12-13).
    for (const p of posts) {
      p.anchorX = p.x;
      p.anchorY = p.y;
    }
    const { distances: distancesPass2 } = associateDistancesRich(
      posts,
      allDistItems,
      [],
      {
        scaleFactor: overviewScale ?? undefined,
        perPageScale,
        skipBifurcationRehome: true,
      },
    );
    // Splice pass-2 labels back into the shared `distances` array so downstream
    // code (calculateCoordinates) sees the refreshed values. CONSERVATIVE
    // splice (siriu-branch-return-labels session 3): only overwrite pass-1
    // when pass-1 had no value, OR pass-1's chord-ratio was wildly off.
    // This preserves correct pass-1 labels for routes where Numero_Poste
    // OCR anchors are already on the cable (Siriu) while still letting
    // pass-2 correct routes where pass-1 anchors were off-cable (João Born).
    for (const d of distances) {
      const d2 = distancesPass2.find(
        (x) => x.from === d.from && x.to === d.to,
      );
      if (!d2) continue;
      if (d.meters == null) {
        // Keep bifurcation tap-leg clears (e.g. 37→38); pass-2 sequential may reassign.
        if (d.source === "bifurcation-cleared") continue;
        d.meters = d2.meters;
        d.source = d2.source;
        continue;
      }
      // Compute pass-1 chord ratio (pdfM / labelM). Only let pass-2 win
      // when pass-1 was outside the [0.4, 2.5] band.
      const a1 = pass1Snapshot.get(d.from);
      const b1 = pass1Snapshot.get(d.to);
      if (!a1 || !b1 || a1.pageNum == null || b1.pageNum == null) {
        // No anchor info — fall back to pass-2 win (legacy behaviour).
        d.meters = d2.meters;
        d.source = d2.source;
        continue;
      }
      const samePage = a1.pageNum === b1.pageNum;
      const sf = samePage
        ? perPageScale(a1.pageNum)
        : null;
      if (sf == null || !samePage) {
        // Cross-page or no scale: don't overwrite a labeled pass-1 value
        // (cross-page label association is already specialised).
        continue;
      }
      const chordPt = Math.hypot(b1.x - a1.x, b1.y - a1.y);
      // perPageScale already returns the per-page scale; only convert via
      // (303.6/1191) when falling back to overview. Mirror associateDistances
      // exactly: pageSf is used directly when available.
      const detailSf = sf;
      const pdfM1 = chordPt * detailSf;

      if (d.meters > 0 && pdfM1 > 0) {
        const ratio1 = pdfM1 / d.meters;
        // If pass-1 ratio is wildly off, pass-2 wins (João Born case).
        if (ratio1 < 0.4 || ratio1 > 2.5) {
          d.meters = d2.meters;
          d.source = d2.source;
          continue;
        }
      }
      // Pass-1 looks consistent — keep it.
      if (
        d.source === "bifurcation-main" ||
        d.source === "bifurcation-tap" ||
        d.source === "bifurcation-cleared"
      ) {
        continue;
      }
    }
    for (const d2 of distancesPass2) {
      if (
        !distances.some((x) => x.from === d2.from && x.to === d2.to) &&
        d2.meters != null
      ) {
        distances.push({ ...d2 });
      }
    }
    const cablesForPass2 = buildCablesByPage(allCablePaths);
    prefillGapDistancesForPolePlacement(posts, distances, cablesForPass2);
    applyJumpbackDistanceCleanup(
      posts,
      allDistItems,
      distances,
      warnings,
      {
        scaleFactor: overviewScale ?? undefined,
        perPageScale,
      },
    );
    applyBifurcationJunctionLabelRehome(
      posts,
      allDistItems,
      distances,
      warnings,
    );
    assignPolesGloballyByLabels(
      posts,
      allPosteRaw,
      allCablePaths,
      distances,
      warnings,
      {
        postByNum: new Map(posts.map((p) => [p.number, p])),
        perPageScale,
      },
    );
    if (process.env?.PP_DBG === "1") {
      console.error(`[PP_DBG] POST-N3#2 numbers=[${posts.map(p => p.number).join(",")}]`);
    }
  } else {
    assignPostPositionsFromPosteSymbols(
      posts,
      allPosteRaw,
      allCablePaths,
      warnings,
      {
        postByNum: new Map(posts.map((p) => [p.number, p])),
      },
    );
  }
  return posts;
}
