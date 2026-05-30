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

function pageOfEntry(entry) {
  return entry.circle?.pageNum ?? entry.pageNum ?? 1;
}

/**
 * Nearest index with a trusted number, preferring the same detail sheet.
 * Multi-sheet routes (Siriu) must not use cross-page neighbors for inference.
 */
function nearestTrustedIdx(
  sorted,
  trusted,
  i,
  direction,
  samePageOnly = false,
  maxPost = null,
) {
  const page = pageOfEntry(sorted[i]);
  const step = direction < 0 ? -1 : 1;
  const start = i + step;
  const end = direction < 0 ? -1 : sorted.length;
  const ok = (k) =>
    maxPost != null ? hasContextNumber(sorted, k, maxPost) : trusted[k];

  if (samePageOnly) {
    for (let k = start; direction < 0 ? k > end : k < end; k += step) {
      if (!ok(k)) continue;
      if (pageOfEntry(sorted[k]) === page) return k;
    }
    return -1;
  }

  for (let k = start; direction < 0 ? k > end : k < end; k += step) {
    if (!ok(k)) continue;
    if (pageOfEntry(sorted[k]) === page) return k;
  }
  for (let k = start; direction < 0 ? k > end : k < end; k += step) {
    if (ok(k)) return k;
  }
  return -1;
}

/** When neighbors are N and N+2, the middle post must be N+1. */
function sandwichValue(lo, hi) {
  if (hi - lo !== 2) return null;
  return lo + 1;
}

/** Clear under-read / CAD typo vs bracket expectation (8→58, 7→71, 30→50, 40→70). */
function isTruncatedMisread(n, expected) {
  if (n == null || expected == null || n === expected) return false;
  const sn = String(n);
  const se = String(expected);
  if (n <= 9 && expected >= 50 && se.endsWith(sn)) return true;
  const gap = expected - n;
  if (gap === 30 && n >= 35 && n <= 45 && expected >= 65) return true;
  if (gap === 20 && n >= 25 && n <= 35 && expected >= 45) return true;
  if (gap >= 50 && n <= 9 && expected >= 50) return true;
  return false;
}

/**
 * Single-digit OCR inside a two-digit label (7→71, 8→58). Used only for bracket endpoints.
 * @param {typeof sorted[0]} entry
 * @param {number} maxPost
 */
function expandedSingleDigitEndpoint(entry, maxPost) {
  const raw = entry.number;
  const n = contextNumber(entry, maxPost);
  if (n == null || raw == null || n > 9) return n;
  for (let exp = n + 10; exp <= maxPost; exp += 10) {
    if (isTruncatedMisread(raw, exp)) return exp;
  }
  return n;
}

/**
 * Route-order labels on one page (global page→x→y sort). Skips the circle at `skipIdx`.
 */
function pageLabelSequence(sorted, page, maxPost) {
  const seq = [];
  for (let j = 0; j < sorted.length; j++) {
    if (pageOfEntry(sorted[j]) !== page) continue;
    const n = expandedSingleDigitEndpoint(sorted[j], maxPost);
    if (n != null) seq.push({ j, n });
  }
  return seq;
}

function hasRouteLabelOnPage(
  sorted,
  page,
  target,
  maxPost,
  beforeIdx,
  afterIdx,
) {
  for (let j = 0; j < sorted.length; j++) {
    if (pageOfEntry(sorted[j]) !== page) continue;
    if (beforeIdx != null && j >= beforeIdx) continue;
    if (afterIdx != null && j <= afterIdx) continue;
    const n = expandedSingleDigitEndpoint(sorted[j], maxPost);
    if (n === target) return true;
  }
  if (beforeIdx != null) {
    for (let j = sorted.length - 1; j >= 0; j--) {
      if (pageOfEntry(sorted[j]) !== page - 1) continue;
      const n = expandedSingleDigitEndpoint(sorted[j], maxPost);
      if (n === target) return true;
      break;
    }
  } else if (afterIdx != null) {
    for (let j = 0; j < sorted.length; j++) {
      if (pageOfEntry(sorted[j]) !== page + 1) continue;
      const n = expandedSingleDigitEndpoint(sorted[j], maxPost);
      if (n === target) return true;
      break;
    }
  }
  return false;
}

/**
 * PDF typo or truncation between route neighbors N and N+2 (e.g. CAD "40" between 69 and 71).
 */
function sequenceTypoExpected(sorted, i, maxPost) {
  const raw = sorted[i].number;
  if (raw == null) return null;
  const page = pageOfEntry(sorted[i]);
  let best = null;
  let bestScore = Infinity;
  for (let exp = 1; exp <= maxPost; exp++) {
    if (raw === exp) continue;
    if (!isTruncatedMisread(raw, exp)) continue;
    const lo = exp - 1;
    const hi = exp + 1;
    if (
      hasRouteLabelOnPage(sorted, page, lo, maxPost, i, null) &&
      hasRouteLabelOnPage(sorted, page, hi, maxPost, null, i)
    ) {
      const score = Math.abs(exp - raw);
      if (score < bestScore) {
        bestScore = score;
        best = exp;
      }
    }
  }
  if (raw <= 9) {
    for (let exp = raw + 10; exp <= maxPost; exp += 10) {
      if (!isTruncatedMisread(raw, exp)) continue;
      if (!hasRouteLabelOnPage(sorted, page, exp - 1, maxPost, i, null))
        continue;
      const score = Math.abs(exp - raw);
      if (score < bestScore) {
        bestScore = score;
        best = exp;
      }
    }
  }
  return best;
}

// Tesseract digit misread offsets for 90s range corrections (e.g. 99 -> 59, 93 -> 55)
const TESSERACT_DIGIT_MISREAD_OFFSET_PRIMARY = 40; // E.g., 99 -> 59 correction
const TESSERACT_DIGIT_MISREAD_OFFSET_SECONDARY = 38; // E.g., 93 -> 55 correction

/** Candidate repairs for 90s-style OCR (99→59, 93→53 or 55). */
function repairNinetiesCandidates(n, maxPost) {
  if (n < 86 || n > 99) return [];
  return [
    n - TESSERACT_DIGIT_MISREAD_OFFSET_PRIMARY,
    n - TESSERACT_DIGIT_MISREAD_OFFSET_SECONDARY,
  ].filter((c) => c >= 1 && c <= maxPost);
}

/** Default repair for neighbor context (prefer n−40: 99→59). */
function repairNinetiesMisread(n, maxPost) {
  const cands = repairNinetiesCandidates(n, maxPost);
  return cands.length ? cands[0] : null;
}

/** Best-effort numeric label for sandwich context (in-range OCR or repaired 90s). */
function contextNumber(entry, maxPost) {
  const n = entry.number;
  if (n == null) return null;
  if (n >= 1 && n <= maxPost) return n;
  return repairNinetiesMisread(n, maxPost);
}

function hasContextNumber(sorted, i, maxPost) {
  return contextNumber(sorted[i], maxPost) != null;
}

/**
 * Same-sheet context neighbor; if none, the label at the sheet edge (prev page last / next page first).
 */
function nearestContextNeighbor(sorted, i, direction, maxPost) {
  const page = pageOfEntry(sorted[i]);
  const pi = nearestTrustedIdx(sorted, [], i, direction, true, maxPost);
  if (pi >= 0) return pi;

  if (direction < 0) {
    for (let idx = sorted.length - 1; idx >= 0; idx--) {
      if (pageOfEntry(sorted[idx]) !== page - 1) continue;
      if (hasContextNumber(sorted, idx, maxPost)) return idx;
      break;
    }
  } else {
    for (let idx = 0; idx < sorted.length; idx++) {
      if (pageOfEntry(sorted[idx]) !== page + 1) continue;
      if (hasContextNumber(sorted, idx, maxPost)) return idx;
      break;
    }
  }
  return -1;
}

/**
 * On a detail sheet, find N and N+2 labels that bracket this circle in route order
 * (page → x → y), even when other posts sit between them (e.g. 69, 50, 40, 71 → 70).
 *
 * @param {{ onlyIfOutlier?: boolean }} [opts]
 *   When true (default), only return N+1 if this circle's OCR is far from that value.
 *   Prevents assigning 40 to every pole spatially between labels 39 and 41 on a long sheet.
 * @returns {number|null} expected post number (N+1) or null
 */
/**
 * Labels on this detail sheet, plus the last/first label on adjacent sheets
 * (Siriu route continues 57 on page 6 → 58 on page 7 even when OCR reads 99 for 59).
 */
function numberedOnPageWithSheetEdges(sorted, page, pageIndices, i, maxPost) {
  const numbered = pageIndices
    .map((idx, p) => ({ idx, p, n: contextNumber(sorted[idx], maxPost) }))
    .filter((x) => x.n != null && x.idx !== i);

  for (let idx = sorted.length - 1; idx >= 0; idx--) {
    if (pageOfEntry(sorted[idx]) !== page - 1) continue;
    const n = contextNumber(sorted[idx], maxPost);
    if (n != null) {
      numbered.push({ idx, p: -1, n });
      break;
    }
  }
  for (let idx = 0; idx < sorted.length; idx++) {
    if (pageOfEntry(sorted[idx]) !== page + 1) continue;
    const n = contextNumber(sorted[idx], maxPost);
    if (n != null) {
      numbered.push({ idx, p: pageIndices.length, n });
      break;
    }
  }
  return numbered;
}

function bracketSandwichExpected(sorted, i, maxPost, opts = {}) {
  const onlyIfOutlier = opts.onlyIfOutlier !== false;
  const raw = sorted[i].number;
  const page = pageOfEntry(sorted[i]);

  const typo = sequenceTypoExpected(sorted, i, maxPost);
  if (typo != null && (!onlyIfOutlier || isTruncatedMisread(raw, typo))) {
    return typo;
  }

  const seq = pageLabelSequence(sorted, page, maxPost);
  const pos = seq.findIndex((e) => e.j === i);
  if (pos < 0) return null;

  let best = null;
  let bestScore = Infinity;
  for (let a = 0; a < pos; a++) {
    for (let b = pos + 1; b < seq.length; b++) {
      const lo = Math.min(seq[a].n, seq[b].n);
      const hi = Math.max(seq[a].n, seq[b].n);
      const expected = sandwichValue(lo, hi);
      if (expected == null) continue;
      if (onlyIfOutlier && !isTruncatedMisread(raw, expected)) continue;
      const span = b - a;
      const score = span * 1000 + Math.abs((raw ?? 0) - expected);
      if (score < bestScore) {
        bestScore = score;
        best = expected;
      }
    }
  }
  return best;
}

/**
 * Infer post number after OCR reject/failure. Same-page sandwich first, then 90s repair,
 * then same-page interpolation; global neighbors only as last resort.
 */
function inferPostNumber(i, sorted, trusted, maxPost, rawNumber) {
  const typo = sequenceTypoExpected(sorted, i, maxPost);
  if (typo != null) return typo;

  const bracket = bracketSandwichExpected(sorted, i, maxPost, {
    onlyIfOutlier: true,
  });
  if (bracket != null) return bracket;

  const ctx = (idx) => contextNumber(sorted[idx], maxPost);
  const pi = nearestContextNeighbor(sorted, i, -1, maxPost);
  const ni = nearestContextNeighbor(sorted, i, 1, maxPost);
  if (pi >= 0 && ni >= 0) {
    const samePageSandwich = sandwichValue(ctx(pi), ctx(ni));
    if (samePageSandwich != null) return samePageSandwich;
  }

  if (rawNumber != null) {
    const repaired = repairNinetiesMisread(rawNumber, maxPost);
    if (repaired != null) {
      // 93→53, 99→59 (n−40). Do not midpoint-pick toward 55 on long spans.
      if (pi >= 0 && ni >= 0) {
        const imm = sandwichValue(ctx(pi), ctx(ni));
        if (imm != null) return imm;
      }
      return repaired;
    }
  }

  if (pi >= 0 && ni >= 0) {
    const lo = ctx(pi);
    const hi = ctx(ni);
    if (hi > lo) {
      const span = ni - pi;
      const offset = i - pi;
      return lo + Math.round(((hi - lo) * offset) / span);
    }
  } else if (pi >= 0) {
    return ctx(pi) + (i - pi);
  } else if (ni >= 0) {
    return ctx(ni) - (ni - i);
  }

  const piG = nearestTrustedIdx(sorted, trusted, i, -1, false, maxPost);
  const niG = nearestTrustedIdx(sorted, trusted, i, 1, false, maxPost);
  if (piG >= 0 && niG >= 0) {
    const globalSandwich = sandwichValue(ctx(piG), ctx(niG));
    if (globalSandwich != null) return globalSandwich;
  }

  if (piG >= 0 && niG >= 0) {
    const lo = ctx(piG);
    const hi = ctx(niG);
    if (hi > lo) {
      const span = niG - piG;
      const offset = i - piG;
      return lo + Math.round(((hi - lo) * offset) / span);
    }
  }
  return null;
}

/**
 * Short Portuguese phrase for user-facing rename notices (neighbors on route).
 */
function neighborContextPhrase(sorted, i, maxPost) {
  const pi = nearestContextNeighbor(sorted, i, -1, maxPost);
  const ni = nearestContextNeighbor(sorted, i, 1, maxPost);
  const lo =
    pi >= 0 ? expandedSingleDigitEndpoint(sorted[pi], maxPost) : null;
  const hi =
    ni >= 0 ? expandedSingleDigitEndpoint(sorted[ni], maxPost) : null;
  if (lo != null && hi != null) {
    if (hi - lo === 2) return `entre os postes ${lo} e ${hi}`;
    return `entre os postes ${lo} e ${hi} na folha`;
  }
  if (lo != null) return `após o poste ${lo}`;
  if (hi != null) return `antes do poste ${hi}`;
  return "sequência da rota na folha";
}

/** Bracket pair (lo, hi) that explains an assigned sandwich number N+1. */
function bracketPairForAssigned(sorted, i, maxPost, assigned) {
  const page = pageOfEntry(sorted[i]);
  const mid = assigned - 1;
  const hi = assigned + 1;
  if (
    assigned >= 2 &&
    hasRouteLabelOnPage(sorted, page, mid, maxPost, i, null) &&
    hasRouteLabelOnPage(sorted, page, hi, maxPost, null, i)
  ) {
    return { lo: mid, hi };
  }

  const seq = pageLabelSequence(sorted, page, maxPost);
  const pos = seq.findIndex((e) => e.j === i);
  if (pos < 0) return null;

  let best = null;
  let bestScore = Infinity;
  for (let a = 0; a < pos; a++) {
    for (let b = pos + 1; b < seq.length; b++) {
      const lo = Math.min(seq[a].n, seq[b].n);
      const hiN = Math.max(seq[a].n, seq[b].n);
      const sandwich = sandwichValue(lo, hiN);
      if (sandwich !== assigned) continue;
      const score = b - a;
      if (score < bestScore) {
        bestScore = score;
        best = { lo, hi: hiN };
      }
    }
  }
  return best;
}

/** Bracket pair that justified the assigned number (for user messages). */
function renumberContextPhrase(sorted, i, maxPost, assigned) {
  const pair = bracketPairForAssigned(sorted, i, maxPost, assigned);
  if (pair) return `entre os postes ${pair.lo} e ${pair.hi}`;
  return neighborContextPhrase(sorted, i, maxPost);
}

/**
 * User-readable post renumber notice (shown outside developer tools).
 */
export function formatUserPostRenumber(page, ocrRead, assigned, contextPhrase) {
  const readPart =
    ocrRead == null ? "sem número legível no OCR" : `lido como ${ocrRead}`;
  const ctx = contextPhrase ? ` (${contextPhrase})` : "";
  return `Página ${page}: poste ${readPart} renumerado para ${assigned}${ctx}.`;
}

/** User-readable notice when a marker could not be assigned any post number. */
export function formatUserPostSkipped(page, ocrRead) {
  const readPart =
    ocrRead == null
      ? "OCR não leu número"
      : `OCR leu ${ocrRead} (inválido ou inconsistente)`;
  return `Página ${page}: poste ignorado — ${readPart}; não foi possível atribuir número na rota.`;
}

/**
 * Build posts[] from Tesseract.js OCR results.
 *
 * ocrResults: Array<{circle: {x, y, pageNum?}, number: number|null}>
 * Returns { posts: [{number, x, y, pageNum?}], warnings: string[], userWarnings: string[] }
 *
 * For circles where number is null (OCR failure), infer the post number from
 * the sequence of known numbers sorted by page then x-position (D-07).
 */
export function assemblePostsFromOcr(ocrResults) {
  const warnings = [];
  const userWarnings = [];

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

  /**
   * True when bracketed by N and N+2 on the same sheet but OCR is a truncated misread.
   */
  const isSandwichOutlier = (i) => {
    const raw = sorted[i].number;
    const expected = sequenceTypoExpected(sorted, i, MAX_PLAUSIBLE_POST);
    if (expected == null || !isTruncatedMisread(raw, expected)) return false;
    const pi = nearestContextNeighbor(sorted, i, -1, MAX_PLAUSIBLE_POST);
    const ni = nearestContextNeighbor(sorted, i, 1, MAX_PLAUSIBLE_POST);
    if (pi >= 0 && ni >= 0) {
      const lo = contextNumber(sorted[pi], MAX_PLAUSIBLE_POST);
      const hi = contextNumber(sorted[ni], MAX_PLAUSIBLE_POST);
      if (lo != null && hi != null && hi - lo === 2 && raw === lo + 1) {
        return false;
      }
    }
    return true;
  };

  const isAnchor = inRange.map((ok, i) => {
    if (!ok) return false;
    if (!isSandwichOutlier(i)) return true;
    const expected = sequenceTypoExpected(sorted, i, MAX_PLAUSIBLE_POST) ?? 0;
    warnings.push(
      `OCR at (${sorted[i].circle.x.toFixed(1)}, ${sorted[i].circle.y.toFixed(1)}) ` +
        `page ${sorted[i].circle.pageNum ?? "?"}: rejected sandwich outlier ${sorted[i].number} ` +
        `(expected ${expected} from same-page bracket)`,
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
        let forceInfer = false;
        if (number <= 9) {
          const pi = nearestContextNeighbor(sorted, i, -1, MAX_PLAUSIBLE_POST);
          const ni = nearestContextNeighbor(sorted, i, 1, MAX_PLAUSIBLE_POST);
          if (pi >= 0 && ni >= 0) {
            const fix = sandwichValue(
              contextNumber(sorted[pi], MAX_PLAUSIBLE_POST),
              contextNumber(sorted[ni], MAX_PLAUSIBLE_POST),
            );
            if (fix != null && fix > 9 && isTruncatedMisread(number, fix)) {
              warnings.push(
                `OCR at (${circle.x.toFixed(1)}, ${circle.y.toFixed(1)}) ` +
                  `page ${circle.pageNum ?? "?"}: rejected single-digit misread ${number} ` +
                  `(expected ${fix}; neighbors ${contextNumber(sorted[pi], MAX_PLAUSIBLE_POST)}–${contextNumber(sorted[ni], MAX_PLAUSIBLE_POST)})`,
              );
              forceInfer = true;
            }
          }
        }
        if (!forceInfer) {
          posts.push({
            number,
            x: circle.x,
            y: circle.y,
            anchorX: circle.x,
            anchorY: circle.y,
            ...(circle.pageNum !== undefined
              ? { pageNum: circle.pageNum }
              : {}),
          });
          continue;
        }
      } else {
        // in-range but locally inconsistent; fall through to sequence inference
      }
    }

    warnings.push(
      `Post at (${circle.x.toFixed(1)}, ${circle.y.toFixed(1)}) ` +
        `page ${circle.pageNum ?? "?"}: OCR failed — attempting sequence inference`,
    );

    const inferred = inferPostNumber(
      i,
      sorted,
      isAnchor,
      MAX_PLAUSIBLE_POST,
      number,
    );

    if (inferred !== null && inferred >= 1 && inferred <= MAX_PLAUSIBLE_POST) {
      posts.push({
        number: inferred,
        x: circle.x,
        y: circle.y,
        anchorX: circle.x,
        anchorY: circle.y,
        ...(circle.pageNum !== undefined ? { pageNum: circle.pageNum } : {}),
      });
      if (number !== inferred) {
        userWarnings.push(
          formatUserPostRenumber(
            circle.pageNum ?? "?",
            number,
            inferred,
            renumberContextPhrase(
              sorted,
              i,
              MAX_PLAUSIBLE_POST,
              inferred,
            ),
          ),
        );
      }
      warnings.push(
        `Post ${inferred}: number inferred from sequence ` +
          `(OCR read ${number ?? "null"} at page ${circle.pageNum ?? "?"})`,
      );
    } else {
      userWarnings.push(
        formatUserPostSkipped(circle.pageNum ?? "?", number),
      );
      warnings.push(
        `Post at (${circle.x.toFixed(1)}, ${circle.y.toFixed(1)}) ` +
          `page ${circle.pageNum ?? "?"}: OCR failed and sequence inference unavailable — post skipped`,
      );
    }
  }

  attachMarkerAnchors(posts);
  return { posts, warnings, userWarnings };
}
