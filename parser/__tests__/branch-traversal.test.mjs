import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { walkBranchGraph } from "../branch-traversal.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(
    path.join(__dirname, "fixtures", "siriu-junction-ground-truth.json"),
    "utf8",
  ),
);

// Build the graph shape the traversal consumes from the ground-truth fixture.
// Nodes are derived from the edge endpoints; degree from incidence; junction
// slot-counts from the fixture's junction declarations (degree-4 = 2 slots).
function buildGraph(fixture) {
  const adj = new Map();
  const edgeMeters = new Map();
  const key = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;
  // inbound arm per junction = the edge directed armPost -> junction.
  const inbound = {};
  for (const e of fixture.edges) {
    if (!adj.has(e.from)) adj.set(e.from, new Set());
    if (!adj.has(e.to)) adj.set(e.to, new Set());
    adj.get(e.from).add(e.to);
    adj.get(e.to).add(e.from);
    edgeMeters.set(key(e.from, e.to), {
      meters: e.meters,
      crossPage: !!e.crossPage,
    });
    if (e.inbound && e.junction != null) {
      // The junction is `e.to`; its inbound neighbor is `e.from`.
      inbound[String(e.junction)] = e.from;
    }
  }
  const nodes = [...adj.keys()].sort((a, b) => a - b).map((n) => ({
    post: n,
    degree: adj.get(n).size,
    neighbors: [...adj.get(n)].sort((a, b) => a - b),
  }));
  const slots = {};
  for (const [num, j] of Object.entries(fixture.junctions)) {
    slots[num] = j.slots;
  }
  return { nodes, edgeMeters, slots, key, inbound };
}

test("walkBranchGraph visits every post exactly once", () => {
  const graph = buildGraph(FIXTURE);
  const result = walkBranchGraph(graph);
  const totalNodes = graph.nodes.length;
  assert.equal(
    result.visitOrder.length,
    totalNodes,
    `expected ${totalNodes} visits, got ${result.visitOrder.length}`,
  );
  assert.equal(
    new Set(result.visitOrder).size,
    totalNodes,
    "every post visited exactly once (no duplicates)",
  );
});

test("each junction exposes (degree-1) arms; degree-4 junction has 2 slots consumed", () => {
  const graph = buildGraph(FIXTURE);
  const result = walkBranchGraph(graph);
  for (const [num, j] of Object.entries(FIXTURE.junctions)) {
    const armCount = result.armsByJunction[num]?.length ?? 0;
    assert.equal(
      armCount,
      j.degree - 1,
      `junction ${num} should expose degree-1 = ${j.degree - 1} arms, got ${armCount}`,
    );
    assert.equal(
      result.slotsConsumed[num],
      j.slots,
      `junction ${num} should consume ${j.slots} slot(s), consumed ${result.slotsConsumed[num]}`,
    );
  }
});

test("traversal reproduces ground-truth junction arms and arm meters", () => {
  const graph = buildGraph(FIXTURE);
  const result = walkBranchGraph(graph);
  for (const [num, j] of Object.entries(FIXTURE.junctions)) {
    const expectedArms = j.arms
      .filter((a) => !a.inbound)
      .map((a) => a.to)
      .sort((a, b) => a - b);
    const gotArms = [...(result.armsByJunction[num] ?? [])]
      .map((a) => a.to)
      .sort((a, b) => a - b);
    assert.deepEqual(
      gotArms,
      expectedArms,
      `junction ${num} arms mismatch`,
    );
    for (const arm of j.arms.filter((a) => !a.inbound)) {
      const got = (result.armsByJunction[num] ?? []).find(
        (x) => x.to === arm.to,
      );
      assert.ok(got, `junction ${num} missing arm ->${arm.to}`);
      assert.equal(
        got.meters,
        arm.meters,
        `junction ${num} arm ->${arm.to} meters mismatch`,
      );
    }
  }
});

test("cross-page arm (62->81) is preserved with its meters and crossPage flag", () => {
  const graph = buildGraph(FIXTURE);
  const result = walkBranchGraph(graph);
  const arm81 = (result.armsByJunction["62"] ?? []).find((a) => a.to === 81);
  assert.ok(arm81, "junction 62 must expose arm ->81");
  assert.equal(arm81.meters, 40.6, "62->81 must carry 40.6 m");
  assert.equal(arm81.crossPage, true, "62->81 must be flagged cross-page");
});
