import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parseDxfText } from "../dwg/dxf-loader.js";
import { deriveCableTopology } from "../dwg/cable-topology.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const DXF = path.join(ROOT, "siriu.dxf");
const FIXTURE = path.join(__dirname, "fixtures", "siriu-dwg-kmz.json");

/**
 * Generic cable-topology derivation, validated end-to-end on the Siriu drawing.
 * Connectivity comes entirely from the cable polylines (TrechoSecundario/Primario
 * Aereo) + the DWG-paired post positions — no post numbers, no per-network data.
 * Locks the field-verified route (2026-06-01): real edges present, numbering
 * artifacts absent, every post on the path, fully connected from the cable alone.
 */
describe("cable-topology derivation (Siriu)", () => {
  if (!existsSync(DXF)) {
    it("skipped — siriu.dxf not present (gitignored)", () => {});
    return;
  }

  const { cableEdges, primaryCableEdges } = parseDxfText(readFileSync(DXF, "utf8"));
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
  const r = deriveCableTopology(
    fixture.posts,
    [...cableEdges, ...primaryCableEdges],
    { zone: 22 },
  );
  const E = new Set(r.edges.map((e) => `${Math.min(e.from, e.to)}-${Math.max(e.from, e.to)}`));
  const has = (a, b) => E.has(`${Math.min(a, b)}-${Math.max(a, b)}`);

  it("dxf-loader extracts both aerial cable layers", () => {
    assert.ok(cableEdges.length > 0, "secondary cable edges present");
    assert.ok(primaryCableEdges.length > 0, "primary cable edges present");
    assert.ok(cableEdges.every((e) => e.poly != null), "edges carry polyline id");
  });

  it("derives a single connected route with no bridging heuristics", () => {
    assert.equal(r.components, 1, "cable connects the whole route");
    assert.equal(r.bridges, 0, "no gap-bridge fallbacks needed");
  });

  it("recovers real edges the numbering/label parser dropped", () => {
    for (const [a, b] of [
      [18, 19], [38, 39], [42, 43], [65, 66], [66, 67], // were suppressed
      [36, 46], [60, 69], [62, 81], // branch jumps numbering never proposed
      [59, 65], // cable-real (65 is a post behind, near 59 — not 64)
    ]) {
      assert.ok(has(a, b), `expected cable edge ${a}-${b}`);
    }
  });

  it("omits numbering artifacts (long fake spans)", () => {
    for (const [a, b] of [
      [38, 42], [45, 46], [80, 81], [64, 66], [68, 69],
    ]) {
      assert.ok(!has(a, b), `edge ${a}-${b} must not be derived`);
    }
  });

  it("places every post on the cable path", () => {
    const onPath = new Set();
    for (const e of r.edges) { onPath.add(e.from); onPath.add(e.to); }
    const missing = fixture.posts.map((p) => p.number).filter((n) => !onPath.has(n));
    assert.deepEqual(missing, [], `posts skipped: ${missing.join(",")}`);
  });
});
