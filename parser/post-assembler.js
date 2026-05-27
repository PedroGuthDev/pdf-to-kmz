// parser/post-assembler.js
// Assembles post data by spatial proximity matching between TEXTO text items
// and Numero_Poste circle centroids. Deduplicates posts across pages.
//
// Named ESM exports only — no default export, no CommonJS require.

import { attachMarkerAnchors } from "./post-positioning.js";

// ~200 pt: Poste anchors are often on the label block, not at the circle centroid.
export const PROXIMITY_THRESHOLD = 200;

// Cross-page penalty: added to distance when text and circle are on different pages.
// Large enough to always prefer a same-page match over any cross-page match (CR-03).
const CROSS_PAGE_PENALTY = 1e6;

/**
 * Euclidean distance between two {x, y} points.
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 * @returns {number}
 */
function distance2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Horizontal anchor closer to visual center of a text run (pdf.js width).
 *
 * @param {{ x: number, y: number, width?: number }} t
 * @returns {{ x: number, y: number }}
 */
function textAnchor(t) {
  const w = typeof t.width === "number" && t.width > 0 ? t.width : 0;
  return { x: w > 0 ? t.x + w * 0.5 : t.x, y: t.y };
}

/**
 * Match TEXTO text items to Numero_Poste circle centroids by spatial proximity.
 *
 * Only text items whose str matches /^\d{1,3}$/ (1-3 digit sequential numbers)
 * are considered. Each circle and each text is used at most once. Pairs are
 * chosen iteratively by the globally shortest edge within PROXIMITY_THRESHOLD
 * (with cross-page penalty for ranking), avoiding order bias from text-only greedy matching.
 *
 * @param {Array<{ str: string, x: number, y: number }>} textoItems
 *   Text items from the TEXTO layer (flipY already applied by pdf-parser.js).
 * @param {Array<{ x: number, y: number }>} circles
 *   Circle centroids from Numero_Poste layer (flipY already applied).
 * @param {string[]} warnings  Mutable warning accumulator (D-07).
 * @returns {{ posts: Array<{ number: number, x: number, y: number, pageNum?: number }>, warnings: string[] }}
 */
export function assemblePostData(textoItems, circles, warnings = []) {
  const posts = [];

  const digitItems = textoItems.filter((t) => {
    const s = t.str.trim();
    return /^\d{1,3}$/.test(s) && parseInt(s, 10) >= 1;
  });
  const usedCircle = new Set();
  const usedText = new Set();

  // Greedy by globally shortest text–circle edge first (within threshold).
  // Text-ordered greedy caused under-matching when two labels “competed” for the same
  // nearest circle — the first text consumed it and the second fell outside 50 pt.
  while (true) {
    let bestTi = -1;
    let bestCi = -1;
    let bestDist = Infinity;
    let bestScore = Infinity;

    for (let ti = 0; ti < digitItems.length; ti++) {
      if (usedText.has(ti)) continue;
      const text = digitItems[ti];
      const anchor = textAnchor(text);
      for (let ci = 0; ci < circles.length; ci++) {
        if (usedCircle.has(ci)) continue;
        const d = distance2D(anchor, circles[ci]);
        const crossPagePenalty =
          text.pageNum != null &&
          circles[ci].pageNum != null &&
          text.pageNum !== circles[ci].pageNum
            ? CROSS_PAGE_PENALTY
            : 0;
        const score = d + crossPagePenalty;
        if (score < bestScore || (score === bestScore && d < bestDist)) {
          bestScore = score;
          bestDist = d;
          bestTi = ti;
          bestCi = ci;
        }
      }
    }

    if (bestTi === -1 || bestDist > PROXIMITY_THRESHOLD) break;

    const text = digitItems[bestTi];
    const trimmed = text.str.trim();
    console.debug(
      `[postAssembler] "${trimmed}" → circle ${bestCi}: ${bestDist.toFixed(1)} pt` +
        (bestScore > bestDist
          ? ` (cross-page, score=${bestScore.toFixed(0)})`
          : ""),
    );

    usedText.add(bestTi);
    usedCircle.add(bestCi);
    const c = circles[bestCi];
    posts.push({
      number: parseInt(trimmed, 10),
      x: c.x,
      y: c.y,
      pageNum: c.pageNum,
    });
  }

  for (let ti = 0; ti < digitItems.length; ti++) {
    if (usedText.has(ti)) continue;
    const text = digitItems[ti];
    const trimmed = text.str.trim();
    const anchor = textAnchor(text);
    let nearestIdx = -1;
    let nearestDist = Infinity;
    for (let ci = 0; ci < circles.length; ci++) {
      const d = distance2D(anchor, circles[ci]);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = ci;
      }
    }
    warnings.push(
      `Post number "${trimmed}" at (${anchor.x.toFixed(1)}, ${anchor.y.toFixed(1)}) ` +
        `has no nearby circle within ${PROXIMITY_THRESHOLD} PDF points` +
        (nearestIdx !== -1 ? ` (nearest: ${nearestDist.toFixed(1)} pt)` : ""),
    );
  }

  return { posts, warnings };
}

/**
 * Deduplicate posts across pages, keeping first occurrence per sequential number.
 * Sorted by number ascending on return (D-13, D-11).
 *
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, postType?: string }>} allPosts
 * @returns {Array<{ number: number, x: number, y: number, pageNum?: number, postType?: string }>}
 */
export function deduplicatePosts(allPosts) {
  const seen = new Set();
  const deduped = allPosts.filter((p) => {
    if (seen.has(p.number)) return false;
    seen.add(p.number);
    return true;
  });
  return deduped.sort((a, b) => a.number - b.number);
}

/**
 * One post per sequential number: keep the occurrence on the **highest page number**
 * (detail pages 3+ have accurate positions in a unified coordinate system;
 * page 2 is the overview with a different scale — unreliable for bearing/GPS — D-04).
 *
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number, postType?: string }>} allPosts
 * @returns {Array<{ number: number, x: number, y: number, pageNum?: number, postType?: string }>}
 */
/**
 * Prefer viewport-calibrated detail pages (3, 4, …) over overview/technical pages.
 * When no calibratedPageNums provided, keeps the higher pageNum (detail over overview).
 *
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number }>} allPosts
 * @param {number[] | null} [calibratedPageNums]
 */
export function deduplicatePostsPreferLowerPage(
  allPosts,
  calibratedPageNums = null,
) {
  const calSet = calibratedPageNums ? new Set(calibratedPageNums) : null;
  const byNum = new Map();
  for (const p of allPosts) {
    const n = p.number;
    const prev = byNum.get(n);
    if (!prev) {
      byNum.set(n, p);
      continue;
    }
    const score = (post) => {
      const pg = post.pageNum ?? 0;
      if (calSet) return calSet.has(pg) ? 1000 + pg : pg;
      return pg;
    };
    if (score(p) >= score(prev)) byNum.set(n, p);
  }
  return [...byNum.values()].sort((a, b) => a.number - b.number);
}

/** Max distance (pt) to replace Numero_Poste circle centroid with Poste symbol cluster. */
export const POSTE_POSITION_MAX_PT = 150;

/**
 * Shift OCR circle anchors onto Poste-layer pole graphics when a cluster is nearby.
 *
 * @param {Array<{ circle: { x: number, y: number, pageNum?: number }, number: number|null }>} ocrResults
 * @param {Array<{ x: number, y: number, pageNum?: number }>} posteHints
 */
export function applyPosteHintPositions(ocrResults, posteHints) {
  if (!posteHints.length) return ocrResults;
  const candidates = [];
  for (let ri = 0; ri < ocrResults.length; ri++) {
    const { circle } = ocrResults[ri];
    const pg = circle.pageNum ?? 1;
    for (let hi = 0; hi < posteHints.length; hi++) {
      if ((posteHints[hi].pageNum ?? 1) !== pg) continue;
      const d = Math.hypot(
        posteHints[hi].x - circle.x,
        posteHints[hi].y - circle.y,
      );
      if (d < POSTE_POSITION_MAX_PT) candidates.push({ ri, hi, d });
    }
  }
  candidates.sort((a, b) => a.d - b.d);
  const usedResult = new Set();
  const usedHint = new Set();
  const out = ocrResults.map((r) => ({ ...r, circle: { ...r.circle } }));
  for (const { ri, hi } of candidates) {
    if (usedResult.has(ri) || usedHint.has(hi)) continue;
    out[ri].circle.x = posteHints[hi].x;
    out[ri].circle.y = posteHints[hi].y;
    usedResult.add(ri);
    usedHint.add(hi);
  }
  return out;
}

export {
  assignPostsByRouteOrder,
  attachMarkerAnchors,
} from "./post-positioning.js";

/** Same sort key as assemblePostsFromOcr (page → x → y). */
function sortPostsByRouteOrder(posts) {
  return [...posts].sort((a, b) => {
    const pd = (a.pageNum ?? 1) - (b.pageNum ?? 1);
    if (pd !== 0) return pd;
    const dx = a.x - b.x;
    if (Math.abs(dx) > 10) return dx;
    return a.y - b.y;
  });
}

/**
 * When two circles share the same post number, renumber the lower-priority copy
 * to the missing integer between its spatial neighbors (e.g. duplicate 49 + 49 → 49 + 50).
 *
 * @param {Array<{ number: number, x: number, y: number, pageNum?: number }>} posts
 * @param {string[]} [warnings]
 */
export function resolveDuplicatePostNumbers(posts, warnings = []) {
  const used = new Set(posts.map((p) => p.number));
  const byNum = new Map();
  for (const p of posts) {
    if (!byNum.has(p.number)) byNum.set(p.number, []);
    byNum.get(p.number).push(p);
  }

  const sorted = sortPostsByRouteOrder(posts);
  const indexOf = new Map(sorted.map((p, i) => [p, i]));

  for (const [num, group] of byNum) {
    if (group.length <= 1) continue;
    group.sort((a, b) => (b.pageNum ?? 0) - (a.pageNum ?? 0));
    for (let k = 1; k < group.length; k++) {
      const p = group[k];
      const idx = indexOf.get(p) ?? -1;
      let newNum = null;

      const prev = idx > 0 ? sorted[idx - 1] : null;
      const next = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;
      if (prev && next && next.number > prev.number + 1) {
        for (let m = prev.number + 1; m < next.number; m++) {
          if (!used.has(m)) {
            newNum = m;
            break;
          }
        }
      }
      if (newNum == null) {
        for (let m = 1; m <= posts.length; m++) {
          if (!used.has(m)) {
            newNum = m;
            break;
          }
        }
      }
      if (newNum == null) continue;

      warnings.push(
        `Post at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) page ${p.pageNum ?? "?"}: ` +
          `duplicate number ${num} renumbered to ${newNum}`,
      );
      used.add(newNum);
      p.number = newNum;
    }
  }
  return posts;
}

/**
 * Build posts[] from Tesseract.js OCR results.
 *
 * ocrResults: Array<{circle: {x, y, pageNum?}, number: number|null}>
 * Returns { posts: [{number, x, y, pageNum?}], warnings: string[] }
 *
 * For circles where number is null (OCR failure), infer the post number from
 * the sequence of known numbers sorted by page then x-position (D-07).
 */
export function assemblePostsFromOcr(ocrResults) {
  const warnings = [];

  // Sort by pageNum → x → y so that vertically-stacked circles (same X, different Y)
  // are ordered consistently top-to-bottom within each column (CR-03).
  const sorted = [...ocrResults].sort((a, b) => {
    const pd = (a.circle.pageNum ?? 1) - (b.circle.pageNum ?? 1);
    if (pd !== 0) return pd;
    const dx = a.circle.x - b.circle.x;
    if (Math.abs(dx) > 10) return dx; // clearly distinct columns
    return a.circle.y - b.circle.y; // same column — top-to-bottom
  });

  // Upper bound on a real post number = total Numero_Poste circle count.
  // Each post has exactly one Numero_Poste centroid, so the highest valid post
  // number is bounded by the number of OCR'd circles (which equals the total
  // Numero_Poste path count fed in by pdf-parser.js). Anything above this is a
  // coordinate, label code, or distance value misread by OCR.
  const MAX_PLAUSIBLE_POST = ocrResults.length;
  const posts = [];

  // Pre-compute which entries can serve as sequence-inference anchors.
  // Range-checking alone misses in-range OCR typos (70→40, 58→8, 50→30).
  //
  // Do NOT use broad spatial interpolation on multi-sheet PDFs — route order
  // (page→x→y) is not numeric order, and that caused mass false rejections on Siriu.
  //
  // Narrow rule: if spatial neighbors read N and N+2, the middle circle must be N+1.
  const inRange = sorted.map(
    (r) => r.number !== null && r.number >= 1 && r.number <= MAX_PLAUSIBLE_POST,
  );

  const nearestPrevInRangeIdx = (i) => {
    for (let k = i - 1; k >= 0; k--) if (inRange[k]) return k;
    return -1;
  };
  const nearestNextInRangeIdx = (i) => {
    for (let k = i + 1; k < sorted.length; k++) if (inRange[k]) return k;
    return -1;
  };

  /** True when OCR is clearly wrong in a tight N, ?, N+2 sandwich (e.g. 69, 40, 71). */
  const isSandwichOutlier = (i) => {
    const pi = nearestPrevInRangeIdx(i);
    const ni = nearestNextInRangeIdx(i);
    if (pi < 0 || ni < 0) return false;
    const lo = sorted[pi].number;
    const hi = sorted[ni].number;
    if (hi - lo !== 2) return false;
    const expected = lo + 1;
    const n = sorted[i].number;
    if (n === expected) return false;
    return Math.abs(n - expected) >= 5;
  };

  const isAnchor = inRange.map((ok, i) => {
    if (!ok) return false;
    if (!isSandwichOutlier(i)) return true;
    const pi = nearestPrevInRangeIdx(i);
    const ni = nearestNextInRangeIdx(i);
    const expected = sorted[pi].number + 1;
    warnings.push(
      `OCR at (${sorted[i].circle.x.toFixed(1)}, ${sorted[i].circle.y.toFixed(1)}) ` +
        `page ${sorted[i].circle.pageNum ?? "?"}: rejected sandwich outlier ${sorted[i].number} ` +
        `(expected ${expected} between ${sorted[pi].number} and ${sorted[ni].number})`,
    );
    return false;
  });

  for (let i = 0; i < sorted.length; i++) {
    const { circle, number, ringCenter } = sorted[i];

    if (number !== null) {
      if (number < 1 || number > MAX_PLAUSIBLE_POST) {
        warnings.push(
          `OCR at (${circle.x.toFixed(1)}, ${circle.y.toFixed(1)}) ` +
            `page ${circle.pageNum ?? "?"}: rejected implausible number ${number} ` +
            `(valid range 1–${MAX_PLAUSIBLE_POST})`,
        );
        // fall through to sequence-inference block
      } else if (isAnchor[i]) {
        posts.push({
          number,
          x: circle.x,
          y: circle.y,
          anchorX: circle.x,
          anchorY: circle.y,
          ...(circle.pageNum !== undefined ? { pageNum: circle.pageNum } : {}),
        });
        continue;
      } else {
        // in-range but locally inconsistent; fall through to sequence inference
      }
    }

    // OCR failed — infer from nearest plausible OCR anchors in sorted order (D-07).
    warnings.push(
      `Post at (${circle.x.toFixed(1)}, ${circle.y.toFixed(1)}) ` +
        `page ${circle.pageNum ?? "?"}: OCR failed — attempting sequence inference`,
    );

    let lower = null,
      lowerIdx = -1;
    for (let k = i - 1; k >= 0; k--) {
      if (isAnchor[k]) {
        lower = sorted[k];
        lowerIdx = k;
        break;
      }
    }
    let upper = null,
      upperIdx = -1;
    for (let k = i + 1; k < sorted.length; k++) {
      if (isAnchor[k]) {
        upper = sorted[k];
        upperIdx = k;
        break;
      }
    }

    let inferred = null;
    if (lower && upper) {
      const span = upperIdx - lowerIdx;
      const offset = i - lowerIdx;
      inferred =
        lower.number +
        Math.round((upper.number - lower.number) * (offset / span));
    } else if (lower) {
      inferred = lower.number + 1;
    } else if (upper) {
      inferred = upper.number - 1;
    }

    if (inferred !== null && inferred >= 1 && inferred <= MAX_PLAUSIBLE_POST) {
      posts.push({
        number: inferred,
        x: circle.x,
        y: circle.y,
        anchorX: circle.x,
        anchorY: circle.y,
        ...(circle.pageNum !== undefined ? { pageNum: circle.pageNum } : {}),
      });
      warnings.push(
        `Post ${inferred}: number inferred from sequence ` +
          `(OCR failed at page ${circle.pageNum ?? "?"})`,
      );
    } else {
      warnings.push(
        `Post at (${circle.x.toFixed(1)}, ${circle.y.toFixed(1)}) ` +
          `page ${circle.pageNum ?? "?"}: OCR failed and sequence inference unavailable — post skipped`,
      );
    }
  }

  resolveDuplicatePostNumbers(posts, warnings);
  attachMarkerAnchors(posts);
  return { posts, warnings };
}
