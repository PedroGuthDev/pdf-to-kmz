/**
 * DFS-with-slots branch traversal model (Stage A — quick task 260602-lbl).
 *
 * Pure, generic graph model proving the user's traversal semantics in isolation,
 * BEFORE the distance-associator is taught to produce the correct topology:
 *
 *   - degree-1 node          = tip (branch leaf)
 *   - degree >= 3 node       = junction exposing (degree - 1) arms
 *   - a degree-4 junction    = 2 slots (it can host 2 branch excursions)
 *   - at a tip, pop back to the nearest junction WITH A FREE SLOT and consume it
 *
 * The model contains ZERO post-number literals — the topology is driven entirely
 * by node degree and slot accounting, exactly as a generic associator-produced
 * graph would feed it.
 *
 * @typedef {Object} BranchGraph
 * @property {{post:number, degree:number, neighbors:number[]}[]} nodes
 * @property {Map<string,{meters:number, crossPage:boolean}>} edgeMeters  keyed "min-max"
 * @property {Record<string, number>} slots  junction post -> slot count
 * @property {Record<string, number>} inbound junction post -> upstream neighbor post
 * @property {(a:number,b:number)=>string} key  edge key builder
 */

/**
 * Walk the label graph using DFS with junction slot accounting.
 *
 * @param {BranchGraph} graph
 * @returns {{
 *   visitOrder: number[],
 *   armsByJunction: Record<string, {to:number, meters:number, crossPage:boolean}[]>,
 *   slotsConsumed: Record<string, number>,
 *   edgeMetersUsed: {from:number, to:number, meters:number, crossPage:boolean}[]
 * }}
 */
export function walkBranchGraph(graph) {
  const { nodes, edgeMeters, slots, key, inbound = {} } = graph;

  const degree = new Map();
  const neighbors = new Map();
  for (const n of nodes) {
    degree.set(n.post, n.degree);
    neighbors.set(n.post, n.neighbors.slice());
  }

  const isJunction = (post) => (degree.get(post) ?? 0) >= 3;

  // Each junction starts with `slots` free slots (degree-4 => 2). One slot is
  // consumed per branch excursion that returns through the junction.
  const freeSlots = {};
  const consumed = {};
  for (const post of degree.keys()) {
    if (isJunction(post)) {
      const s = slots[String(post)] ?? 1;
      freeSlots[post] = s;
      consumed[post] = 0;
    }
  }

  const visited = new Set();
  const visitOrder = [];
  const edgeMetersUsed = [];

  const edgeInfo = (a, b) => edgeMeters.get(key(a, b)) ?? { meters: null, crossPage: false };

  // Junction stack: junctions encountered with free slots, nearest last. When a
  // tip is reached, pop back to the nearest junction that still has a free slot.
  /** @type {number[]} */
  const junctionStack = [];

  function nearestJunctionWithFreeSlot() {
    for (let i = junctionStack.length - 1; i >= 0; i--) {
      const j = junctionStack[i];
      if (freeSlots[j] > 0) return j;
    }
    return null;
  }

  // Iterative DFS so the model stays generic and stack-safe.
  function dfs(root) {
    /** @type {{post:number, from:number|null}[]} */
    const stack = [{ post: root, from: null }];
    while (stack.length) {
      const { post, from } = stack.pop();
      if (visited.has(post)) continue;
      visited.add(post);
      visitOrder.push(post);
      if (from != null) {
        const info = edgeInfo(from, post);
        edgeMetersUsed.push({ from, to: post, meters: info.meters, crossPage: info.crossPage });
      }

      if (isJunction(post)) {
        if (!junctionStack.includes(post)) junctionStack.push(post);
      }

      const outs = (neighbors.get(post) ?? []).filter((nb) => !visited.has(nb));

      if (outs.length === 0) {
        // Tip (or exhausted node): pop to the nearest junction with a free slot.
        const j = nearestJunctionWithFreeSlot();
        if (j != null) {
          freeSlots[j] -= 1;
          consumed[j] += 1;
        }
        continue;
      }

      // Push neighbors in reverse so the lowest-numbered is explored first.
      for (let i = outs.length - 1; i >= 0; i--) {
        stack.push({ post: outs[i], from: post });
      }
    }
  }

  // Root = lowest-numbered node (deterministic).
  const allPosts = [...degree.keys()].sort((a, b) => a - b);
  for (const root of allPosts) {
    if (!visited.has(root)) dfs(root);
  }

  // Build arms per junction: every incident edge except the inbound one.
  // The inbound arm is the upstream main-line predecessor, supplied as topology
  // (edge directed armPost -> junction). This is generic graph direction, NOT a
  // post-number literal: the model never tests a specific post value.
  const armsByJunction = {};
  for (const post of degree.keys()) {
    if (!isJunction(post)) continue;
    const nbs = (neighbors.get(post) ?? []).slice().sort((a, b) => a - b);
    const inboundNb = inbound[String(post)];
    const arms = nbs
      .filter((nb) => nb !== inboundNb)
      .map((nb) => {
        const info = edgeInfo(post, nb);
        return { to: nb, meters: info.meters, crossPage: info.crossPage };
      });
    armsByJunction[String(post)] = arms;
  }

  return {
    visitOrder,
    armsByJunction,
    slotsConsumed: consumed,
    edgeMetersUsed,
  };
}
