/**
 * Per-network topology corrections.
 *
 * The connection topology the parser derives at branch points is driven by post
 * numbering + distance-label association, because the DWG cable in these drawings is
 * fragmented (drawn as disjoint segments the graph-walker stitches with labels) and
 * cannot be traversed as a clean graph. At branch points post-numbering lies — posts
 * 45/46 are numbered consecutively but are not cable neighbours, while 36/46 are cable
 * neighbours but not consecutive — so the associator emits wrong/missing edges.
 *
 * Until topology can be derived from cable geometry directly, verified corrections are
 * applied per network. Each entry is gated by a SIGNATURE (a set of edges that must be
 * present + a post-count window) so it only fires on the exact drawing it was authored
 * for and never perturbs other networks.
 *
 * Authoring a correction: capture the wrong connections, get ground-truth topology from
 * the field, and express the delta as remove/add/retag. Keep signatures specific.
 */

/** @typedef {{ from: number, to: number, gap?: boolean, source?: string }} Conn */

const SPINE_SOURCE = "inferred-label";

/**
 * @type {Array<{
 *   name: string,
 *   minPosts: number,
 *   maxPosts: number,
 *   signature: string[],
 *   remove: string[],
 *   dropSource: string[],
 *   retagSpine: string[],
 *   add: Array<[number, number]>,
 *   addSpine: Array<[number, number]>,
 * }>}
 */
const CORRECTIONS = [
  {
    // Garopaba / Praia do Siriu (INFOVIAS_PJC...Siriu_v01). 85 posts.
    // Ground truth supplied by the field reviewer (2026-06-01).
    name: "siriu",
    minPosts: 84,
    maxPosts: 86,
    // All five must be present for this to be the Siriu drawing.
    signature: ["38->42", "45->46", "64->66", "68->69", "80->81"],
    // Edges the parser emitted that the cable does NOT actually run.
    remove: ["38->42", "45->46", "64->66", "68->69", "80->81", "41->43"],
    // Edge wrongly tagged as the main trunk — it is a branch, not the spine.
    dropSource: ["36->38"],
    // Real spine continuations at junctions; tag so they stay the drawn trunk.
    retagSpine: ["36->46", "60->61", "62->63", "70->71"],
    // Real edges the parser suppressed/never created (labels exist in the PDF).
    add: [
      [18, 19],
      [38, 39],
      [42, 43],
      [65, 66],
      [66, 67],
      [60, 69],
      [70, 74],
      [62, 81],
    ],
    // Spine jump with no consecutive label; add tagged as the trunk.
    addSpine: [[36, 46]],
  },
];

/**
 * @param {Conn} c
 * @returns {string}
 */
function edgeKey(c) {
  return `${c.from}->${c.to}`;
}

/**
 * Apply the first matching per-network topology correction to a connection list.
 * Returns the input unchanged when no signature matches. Pure — does not mutate input.
 *
 * @param {Conn[]} connections
 * @param {Array<{ number: number }>} posts
 * @returns {{ connections: Conn[], applied: string|null }}
 */
export function applyTopologyCorrections(connections, posts) {
  if (!Array.isArray(connections) || connections.length === 0) {
    return { connections, applied: null };
  }
  const have = new Set(connections.map(edgeKey));
  const postCount = Array.isArray(posts) ? posts.length : 0;

  for (const corr of CORRECTIONS) {
    if (postCount < corr.minPosts || postCount > corr.maxPosts) continue;
    if (!corr.signature.every((e) => have.has(e))) continue;
    return { connections: applyCorrection(connections, corr), applied: corr.name };
  }
  return { connections, applied: null };
}

/**
 * @param {Conn[]} connections
 * @param {(typeof CORRECTIONS)[number]} corr
 * @returns {Conn[]}
 */
function applyCorrection(connections, corr) {
  const remove = new Set(corr.remove);
  const dropSource = new Set(corr.dropSource);
  const retagSpine = new Set(corr.retagSpine);

  const out = [];
  for (const c of connections) {
    const key = edgeKey(c);
    if (remove.has(key)) continue;
    if (dropSource.has(key)) {
      const { source, ...rest } = c;
      out.push(rest);
    } else if (retagSpine.has(key)) {
      out.push({ ...c, source: SPINE_SOURCE });
    } else {
      out.push(c);
    }
  }

  const present = new Set(out.map(edgeKey));
  for (const [from, to] of corr.add) {
    if (!present.has(`${from}->${to}`)) out.push({ from, to });
  }
  for (const [from, to] of corr.addSpine) {
    if (!present.has(`${from}->${to}`)) out.push({ from, to, source: SPINE_SOURCE });
  }
  return out;
}
