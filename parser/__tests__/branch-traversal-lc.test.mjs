import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { walkBranchGraph } from "../branch-traversal.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(
    path.join(__dirname, "fixtures", "luizcarolino-junction-ground-truth.json"),
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

// CORRECTNESS ORACLE (260602-decouple Task 1): assert TOPOLOGY independent of the
// moving idx baseline. For each junction the produced incident-arm set must contain
// EVERY GT arm and NONE of the forbiddenArms phantom targets; arm meters must match
// armMetersChecks where present. This is the Pitfall-10 phantom-edge defense for LC
// (decouple phantom pairs 3->1, 11->8, 9->11).
test("forbidden-arm oracle: each junction carries only GT arms, no phantom arms", () => {
  const graph = buildGraph(FIXTURE);
  const result = walkBranchGraph(graph);

  // Every junction MUST declare a forbiddenArms array (additive metadata oracle).
  for (const [num, j] of Object.entries(FIXTURE.junctions)) {
    assert.ok(
      Array.isArray(j.forbiddenArms),
      `junction ${num} must declare a forbiddenArms array`,
    );
  }

  // The full set of arm targets the GT graph allows to be incident to a junction
  // (outbound arms + inbound neighbor). Any produced incident edge outside this set,
  // or any forbidden target inside it, is a phantom and fails the oracle.
  for (const [num, j] of Object.entries(FIXTURE.junctions)) {
    const allowed = new Set(j.arms.map((a) => a.to));
    const incident = new Set([
      ...(result.armsByJunction[num] ?? []).map((a) => a.to),
    ]);
    // every GT outbound arm is present
    for (const arm of j.arms.filter((a) => !a.inbound)) {
      assert.ok(
        incident.has(arm.to),
        `junction ${num} missing GT arm ->${arm.to}`,
      );
    }
    // no produced incident arm is outside the allowed GT set
    for (const got of incident) {
      assert.ok(
        allowed.has(got),
        `junction ${num} has extra incident arm ->${got} (not in GT set)`,
      );
    }
    // none of the explicitly-forbidden phantom targets is incident
    for (const bad of j.forbiddenArms) {
      assert.ok(
        !incident.has(bad),
        `junction ${num} must NOT carry phantom arm ->${bad}`,
      );
    }
  }

  // Explicit meters checks where the fixture pins arm distances.
  for (const [num, j] of Object.entries(FIXTURE.junctions)) {
    if (!j.armMetersChecks) continue;
    for (const [target, meters] of Object.entries(j.armMetersChecks)) {
      const got = (result.armsByJunction[num] ?? []).find(
        (a) => a.to === Number(target),
      );
      assert.ok(
        got,
        `junction ${num} missing arm ->${target} for meters check`,
      );
      assert.equal(
        got.meters,
        meters,
        `junction ${num} arm ->${target} must be ${meters} m (got ${got.meters})`,
      );
    }
  }
});

// D-15.2 global no-inferred-degree>=3 oracle: build the inferred-only subgraph from
// edges where source === "inferred" and assert no node reaches degree>=3 from inferred
// edges alone. With all-declared fixtures the inferred subgraph is empty and this passes
// trivially — but the rule is now encoded and will catch a future inferred-label phantom
// junction poisoning the Phase 8 solver input graph (Pitfall 10).
test("no degree>=3 junction arises from inferred-label edges alone (D-15.2)", () => {
  const deg = new Map();
  for (const e of FIXTURE.edges.filter((x) => x.source === "inferred")) {
    deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
    deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
  }
  for (const [post, d] of deg) {
    assert.ok(d < 3, `post ${post} reaches degree ${d} from inferred edges alone`);
  }
});
