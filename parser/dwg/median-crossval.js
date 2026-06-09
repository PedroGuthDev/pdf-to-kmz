/**
 * D-08 median cross-validation — pre-solve PDF vs DXF scale/unit guard.
 *
 * Compares the median printed inter-post distance (PDF) to the median DXF cable
 * span (planar UTM via Math.hypot). Agreement within AGREEMENT_FACTOR confirms
 * consistent units/scale before the global solver runs; disagreement is a loud
 * scale-mismatch signal (mm-vs-m, wrong zone, etc.).
 *
 * Pure module: no I/O, no new npm dependency. On pass, absolute tolerances are
 * derived from the agreed medians — only fractions/factors are constants
 * (Pitfall 9).
 */

/** PDF/DXF median agreement band (Claude discretion per A3; calibrate on routes). */
export const AGREEMENT_FACTOR = 2;

/** Fraction of medianPDF used as span tolerance (matches graph-walker seed). */
export const SPAN_TOL_FRAC = 0.15;

/** Candidate search window radius as a multiple of medianPDF. */
export const CANDIDATE_WINDOW_MULT = 2;

function medianOf(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  // Average the two central elements on even length (true median), instead of
  // taking the upper-middle element which biases the median upward.
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * @param {{
 *   distances: Array<{ from: number, to: number, meters: number|null, source?: string }>,
 *   regionEdges: Array<{ a: { x: number, y: number }, b: { x: number, y: number }, ... }>
 * }} params
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   medianPDF?: number,
 *   medianDXF?: number,
 *   ratio?: number,
 *   tolerances?: { spanTolM: number, candidateWindowM: number }
 * }}
 */
export function medianCrossValidate({ distances, regionEdges }) {
  const pdfMeters = [];
  for (const d of distances ?? []) {
    if (d.meters > 0 && !Number.isNaN(d.meters)) pdfMeters.push(d.meters);
  }

  const dxfSpans = [];
  for (const edge of regionEdges ?? []) {
    const ax = edge?.a?.x;
    const ay = edge?.a?.y;
    const bx = edge?.b?.x;
    const by = edge?.b?.y;
    if (ax == null || ay == null || bx == null || by == null) continue;
    const span = Math.hypot(bx - ax, by - ay);
    if (span > 0 && !Number.isNaN(span)) dxfSpans.push(span);
  }

  if (!pdfMeters.length || !dxfSpans.length) {
    return { ok: false, reason: "insufficient-data" };
  }

  const medianPDF = medianOf(pdfMeters);
  const medianDXF = medianOf(dxfSpans);
  // Guard against null/zero medians before dividing: a NaN ratio makes BOTH
  // band comparisons false, which would silently return ok:true on degenerate
  // input and poison every downstream tolerance with NaN.
  if (medianPDF == null || medianDXF == null || !(medianDXF > 0)) {
    return { ok: false, reason: "insufficient-data" };
  }
  const ratio = medianPDF / medianDXF;

  if (
    !Number.isFinite(ratio) ||
    ratio < 1 / AGREEMENT_FACTOR ||
    ratio > AGREEMENT_FACTOR
  ) {
    return { ok: false, reason: "scale-mismatch", medianPDF, medianDXF, ratio };
  }

  return {
    ok: true,
    medianPDF,
    medianDXF,
    ratio,
    tolerances: {
      spanTolM: SPAN_TOL_FRAC * medianPDF,
      candidateWindowM: CANDIDATE_WINDOW_MULT * medianPDF,
    },
  };
}
