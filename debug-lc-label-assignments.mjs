/**
 * Luiz Carolino — full Distância_Poste label inventory and assignment trace.
 * Run: node debug-lc-label-assignments.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import "fake-indexeddb/auto";
import { parsePdf } from "./parser/pdf-parser.js";
import { associateDistances } from "./parser/distance-associator.js";
import { computeScaleFactor } from "./parser/geo/utm-calibrator.js";
import { deduplicatePostsPreferLowerPage } from "./parser/post-assembler.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF = path.join(
  __dirname,
  "INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf",
);

const OVERVIEW_TO_DETAIL_SCALE = 1191 / 842;

function parseMeters(str) {
  const n = str.trim().replace(/\s+/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(n)) return null;
  const m = parseFloat(n);
  return Number.isFinite(m) && m > 0 ? m : null;
}

function distPointToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  let t = ab2 > 1e-12 ? (apx * abx + apy * aby) / ab2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
}

function labelGapToSegment(lx, ly, from, to, crossPage) {
  const ax = from.anchorX ?? from.x;
  const ay = from.anchorY ?? from.y;
  const bx = to.anchorX ?? to.x;
  const by = to.anchorY ?? to.y;
  if (!crossPage) return distPointToSegment(lx, ly, ax, ay, bx, by);
  const gapLo = Math.hypot(lx - ax, ly - ay);
  const gapHi = distPointToSegment(lx, ly, ax, ay, bx, by);
  return Math.min(gapLo, gapHi);
}

/** Mirror inferDistanceEdgesFromLabels with per-label winner. */
function traceInferred(posts, distItems, excluded, opts) {
  const sorted = [...posts].sort((a, b) => a.number - b.number);
  const byPage = new Map();
  for (const p of sorted) {
    const pn = p.pageNum ?? null;
    if (!byPage.has(pn)) byPage.set(pn, []);
    byPage.get(pn).push(p);
  }
  const pos = (p) => ({ x: p.anchorX ?? p.x, y: p.anchorY ?? p.y });
  const TOP_K = 4;
  const MAX_GAP = 30;
  const MAX_SCORE = 80;
  const MAX_SPAN = 6;

  /** @type {Map<number, { from: number, to: number, meters: number, score: number }>} */
  const labelWinner = new Map();
  const edges = [];

  for (let li = 0; li < distItems.length; li++) {
    if (excluded.has(li)) continue;
    const it = distItems[li];
    const meters = parseMeters(it.str);
    if (meters == null) continue;
    const w = typeof it.width === "number" && it.width > 0 ? it.width : 0;
    const lx = w > 0 ? it.x + w * 0.5 : it.x;
    const ly = it.y;
    const labelPage = it.pageNum ?? null;
    const postsOnPage = byPage.get(labelPage) ?? sorted;
    const nearest = postsOnPage
      .map((p) => ({ p, d: Math.hypot(pos(p).x - lx, pos(p).y - ly) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, TOP_K)
      .map((x) => x.p);
    if (nearest.length < 2) continue;
    const sf =
      (labelPage != null && opts.perPageScale?.(labelPage)) ??
      opts.scaleFactor ??
      null;
    let best = null;
    for (let i = 0; i < nearest.length; i++) {
      for (let j = i + 1; j < nearest.length; j++) {
        const a = nearest[i];
        const b = nearest[j];
        const ap = pos(a);
        const bp = pos(b);
        const gap = distPointToSegment(lx, ly, ap.x, ap.y, bp.x, bp.y);
        if (gap > MAX_GAP) continue;
        const abx = bp.x - ap.x;
        const aby = bp.y - ap.y;
        const ab2 = abx * abx + aby * aby;
        if (ab2 < 1e-6) continue;
        const tProj =
          ((lx - ap.x) * abx + (ly - ap.y) * aby) / ab2;
        if (tProj < 0.1 || tProj > 0.9) continue;
        let ratioPenalty = 0;
        if (sf != null && meters > 0) {
          const pdfM = Math.hypot(abx, aby) * sf;
          const ratio = pdfM / meters;
          if (ratio < 0.5 || ratio > 2.0) continue;
          ratioPenalty = 35 * Math.abs(Math.log(ratio));
        }
        const score = gap + ratioPenalty;
        if (score > MAX_SCORE) continue;
        if (!best || score < best.score) best = { a, b, score };
      }
    }
    if (!best) continue;
    const from = best.a.number;
    const to = best.b.number;
    const ia = sorted.findIndex((p) => p.number === from);
    const ib = sorted.findIndex((p) => p.number === to);
    if (ia !== -1 && ib !== -1 && Math.abs(ia - ib) === 1) continue;
    if (ia !== -1 && ib !== -1 && Math.abs(ia - ib) > MAX_SPAN) continue;
    labelWinner.set(li, { from, to, meters, score: best.score });
    edges.push({ from, to, meters, li });
  }

  const dedup = new Map();
  for (const e of edges) {
    const k = `${Math.min(e.from, e.to)}->${Math.max(e.from, e.to)}`;
    const prev = dedup.get(k);
    if (!prev || e.meters < prev.meters) dedup.set(k, e);
  }
  const inferUsed = new Set([...dedup.values()].map((e) => e.li));
  /** @type {Map<number, string>} */
  const inferAssign = new Map();
  for (const e of dedup.values()) {
    inferAssign.set(
      e.li,
      `${e.from}->${e.to} (${e.meters} m, inferred-label)`,
    );
  }
  return { inferUsed, inferAssign };
}

/** Mirror associateDistances greedy with per-label winner. */
function traceSequential(posts, distItems, excluded, opts) {
  const sorted = [...posts].sort((a, b) => a.number - b.number);
  const pdfPos = (p) => ({ x: p.anchorX ?? p.x, y: p.anchorY ?? p.y });
  const candidates = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];
    const samePage =
      from.pageNum != null && to.pageNum != null && from.pageNum === to.pageNum;
    const crossPage = !samePage && from.pageNum != null && to.pageNum != null;
    const pdfPt = Math.hypot(
      pdfPos(to).x - pdfPos(from).x,
      pdfPos(to).y - pdfPos(from).y,
    );
    for (let li = 0; li < distItems.length; li++) {
      if (excluded.has(li)) continue;
      const dt = distItems[li];
      const meters = parseMeters(dt.str);
      if (meters == null) continue;
      const labelPage = dt.pageNum ?? null;
      if (samePage && labelPage != null && labelPage !== from.pageNum) continue;
      if (crossPage && labelPage != null && labelPage !== to.pageNum) continue;
      const w = typeof dt.width === "number" && dt.width > 0 ? dt.width : 0;
      const lx = w > 0 ? dt.x + w * 0.5 : dt.x;
      const ly = dt.y;
      const gap = labelGapToSegment(lx, ly, from, to, crossPage);
      let ratioPenalty = 0;
      const pageSf =
        !crossPage && from.pageNum != null && opts.perPageScale
          ? opts.perPageScale(from.pageNum)
          : null;
      const detailSf =
        pageSf ??
        opts.detailScaleFactor ??
        (opts.scaleFactor != null ? opts.scaleFactor * OVERVIEW_TO_DETAIL_SCALE : null);
      if (!crossPage && detailSf != null && meters > 0 && pdfPt > 0) {
        const pdfM = pdfPt * detailSf;
        const ratio = pdfM / meters;
        const gapPt = labelGapToSegment(lx, ly, from, to, false);
        const labelOnChord = gapPt < 55;
        if ((ratio < 0.35 || ratio > 2.5) && !labelOnChord) continue;
        ratioPenalty = 35 * Math.abs(Math.log(ratio));
      }
      const labelKey = `${li}:${meters}:${lx.toFixed(1)},${ly.toFixed(1)}`;
      candidates.push({ segIdx: i, labelKey, li, score: gap + ratioPenalty, meters });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  const assignedSeg = new Set();
  const assignedLabel = new Set();
  /** @type {Map<number, string>} */
  const seqAssign = new Map();
  for (const c of candidates) {
    if (assignedSeg.has(c.segIdx) || assignedLabel.has(c.labelKey)) continue;
    if (c.score > 120) continue;
    const from = sorted[c.segIdx].number;
    const to = sorted[c.segIdx + 1].number;
    seqAssign.set(
      c.li,
      `${from}->${to} (${c.meters} m, legacy-midpoint, score=${c.score.toFixed(1)}pt)`,
    );
    assignedSeg.add(c.segIdx);
    assignedLabel.add(c.labelKey);
  }
  return { seqAssign, seqUsed: new Set(seqAssign.keys()) };
}

function matchLabelToFinalEdge(li, it, posts, distances) {
  const meters = parseMeters(it.str);
  if (meters == null) return null;
  const w = typeof it.width === "number" && it.width > 0 ? it.width : 0;
  const lx = w > 0 ? it.x + w * 0.5 : it.x;
  const ly = it.y;
  const sorted = [...posts].sort((a, b) => a.number - b.number);
  const byNum = new Map(sorted.map((p) => [p.number, p]));
  let best = null;
  for (const d of distances) {
    if (d.meters == null || Math.abs(d.meters - meters) > 0.25) continue;
    const a = byNum.get(d.from);
    const b = byNum.get(d.to);
    if (!a || !b) continue;
    const cross =
      a.pageNum != null && b.pageNum != null && a.pageNum !== b.pageNum;
    const gap = labelGapToSegment(lx, ly, a, b, cross);
    if (!best || gap < best.gap) {
      best = {
        edge: `${d.from}->${d.to}`,
        meters: d.meters,
        source: d.source ?? "",
        gap,
      };
    }
  }
  return best;
}

const buf = readFileSync(PDF);
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);
if (parsed.error) throw new Error(parsed.error);

const posts = deduplicatePostsPreferLowerPage(parsed.posts ?? []);
const distItems = parsed.distanceLabelItems ?? [];
const grid = parsed.utmGridPathsPerPage;
const overviewScale =
  grid instanceof Map
    ? computeScaleFactor(grid.get(2) ?? [], [])
    : computeScaleFactor(grid?.[2] ?? [], []);
const perPageScale = (pn) => {
  const paths = grid instanceof Map ? grid.get(pn) : grid?.[pn];
  if (paths?.length) {
    const sf = computeScaleFactor(paths, []);
    if (sf != null) return sf;
  }
  return overviewScale ?? null;
};

const { inferUsed, inferAssign } = traceInferred(posts, distItems, new Set(), {
  scaleFactor: overviewScale ?? undefined,
  perPageScale,
});
const { seqAssign } = traceSequential(posts, distItems, inferUsed, {
  scaleFactor: overviewScale ?? undefined,
  perPageScale,
});

console.log("=== Luiz Carolino — all Distância_Poste labels (" + distItems.length + ") ===\n");
console.log(
  "idx  page   meters  x,y (PDF pt)     str          pipeline phase              final edge (parsePdf)",
);
console.log(
  "---- ----- ------ -------------- ------------ --------------------------- ------------------------------",
);

for (let li = 0; li < distItems.length; li++) {
  const it = distItems[li];
  const m = parseMeters(it.str);
  const w = typeof it.width === "number" && it.width > 0 ? it.width : 0;
  const lx = w > 0 ? it.x + w * 0.5 : it.x;
  let phase = "—";
  if (inferAssign.has(li)) phase = "inferred";
  else if (seqAssign.has(li)) phase = "sequential";
  else phase = "not-in-greedy";

  const final = matchLabelToFinalEdge(li, it, posts, parsed.distances ?? []);
  let finalStr = "UNASSIGNED";
  if (final) {
    finalStr = `${final.edge} ${final.meters}m [${final.source}] gap=${final.gap.toFixed(1)}pt`;
  }

  console.log(
    `${String(li).padStart(3)}  p${String(it.pageNum ?? "?").padStart(2)}  ` +
      `${m == null ? "  —   " : m.toFixed(1).padStart(6)}  ` +
      `${lx.toFixed(0)},${it.y.toFixed(0).padStart(4)}  ` +
      `${JSON.stringify(it.str).slice(0, 12).padEnd(12)} ` +
      `${phase.padEnd(11)} ` +
      `${finalStr}`,
  );
}

console.log("\n=== Final distance edges (after full parsePdf + bifurcation) ===\n");
const edges = (parsed.distances ?? []).slice().sort((a, b) => {
  const ka = Math.min(a.from, a.to) * 1000 + Math.max(a.from, a.to);
  const kb = Math.min(b.from, b.to) * 1000 + Math.max(b.from, b.to);
  return ka - kb;
});
console.log("from->to   meters   source");
for (const d of edges) {
  const m = d.meters == null ? "null" : d.meters.toFixed(1);
  console.log(
    `${String(d.from).padStart(2)}->${String(d.to).padStart(2)}  ${String(m).padStart(7)}  ${d.source ?? ""}`,
  );
}

console.log("\n=== Bifurcation / assoc warnings ===\n");
for (const w of parsed.warnings ?? []) {
  if (
    /distance-assoc|Bifurcation|bifurcation|Cleared|inferred|Rich labels/i.test(w)
  ) {
    console.log(w);
  }
}
