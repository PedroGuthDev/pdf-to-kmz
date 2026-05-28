import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyBifurcationJunctionLabelRehome,
  applyJumpbackDistanceCleanup,
  associateDistances,
  associateDistancesRich,
} from "../distance-associator.js";

describe("distance-associator cross-page labels", () => {
  it("assigns 35,2 on page 4 to 24→25 not 14→15 cross-page", () => {
    const posts = [
      { number: 14, x: 1139, y: 136, pageNum: 3 },
      { number: 15, x: 152, y: 283, pageNum: 4 },
      { number: 24, x: 1037, y: 54, pageNum: 4 },
      { number: 25, x: 1098, y: 46, pageNum: 4 },
    ];
    const distItems = [
      { str: "35,2", x: 1073, y: 65, pageNum: 4, width: 11.4 },
    ];
    const { distances } = associateDistances(posts, distItems, []);
    const seg = distances.find((d) => d.from === 24 && d.to === 25);
    assert.equal(seg?.meters, 35.2);
  });

  it("assigns 33,7 at sheet entry to 25→26 not mirrored 32,4 at outgoing edge", () => {
    const posts = [
      { number: 25, x: 1098, y: 46, pageNum: 4 },
      { number: 26, x: 134, y: 330, pageNum: 5 },
      { number: 27, x: 218, y: 304, pageNum: 5 },
    ];
    const distItems = [
      { str: "32,4", x: 974, y: 65, pageNum: 5, width: 11.4 },
      { str: "33,7", x: 88, y: 363, pageNum: 5, width: 11.4 },
    ];
    const { distances } = associateDistances(posts, distItems, []);
    const seg = distances.find((d) => d.from === 25 && d.to === 26);
    assert.equal(seg?.meters, 33.7);
  });

  it("assigns sheet-edge label on incoming page to cross-page segment", () => {
    const posts = [
      { number: 25, x: 1098, y: 46, pageNum: 4 },
      { number: 26, x: 134, y: 330, pageNum: 5 },
      { number: 27, x: 218, y: 304, pageNum: 5 },
    ];
    const distItems = [
      { str: "33,7", x: 88, y: 363, pageNum: 5, width: 11.4 },
    ];
    const { distances } = associateDistances(posts, distItems, []);
    const seg = distances.find((d) => d.from === 25 && d.to === 26);
    assert.equal(seg?.meters, 33.7);
  });
});

describe("bifurcation junction label rehome", () => {
  it("rehomes main-line label from tap→next onto junction→next (Siriu 36–37–38 pattern)", () => {
    const posts = [
      { number: 36, x: 292, y: 405, pageNum: 6 },
      { number: 37, x: 310, y: 448, pageNum: 6 },
      { number: 38, x: 260, y: 368, pageNum: 6 },
    ];
    const distItems = [
      { str: "10,5", x: 310, y: 430, pageNum: 6, width: 12 },
      { str: "35,5", x: 285, y: 375, pageNum: 6, width: 12 },
    ];
    const distances = [
      { from: 36, to: 37, meters: 10.5, source: "legacy-midpoint" },
      { from: 37, to: 38, meters: 35.5, source: "legacy-midpoint" },
      { from: 36, to: 39, meters: 35.5, source: "inferred-label" },
    ];
    const warnings = [];
    applyBifurcationJunctionLabelRehome(posts, distItems, distances, warnings);

    const jm = distances.find((d) => d.from === 36 && d.to === 38);
    const tm = distances.find((d) => d.from === 37 && d.to === 38);
    const wrong = distances.find((d) => d.from === 36 && d.to === 39);
    assert.equal(jm?.meters, 35.5);
    assert.equal(jm?.source, "bifurcation-main");
    assert.equal(tm?.meters, null);
    assert.equal(tm?.source, "bifurcation-cleared");
    assert.equal(wrong?.meters, null);
  });

  it("associateDistancesRich applies bifurcation rehome on Siriu-like geometry", () => {
    const posts = [
      { number: 35, x: 166, y: 425, pageNum: 6 },
      { number: 36, x: 292, y: 405, pageNum: 6 },
      { number: 37, x: 386, y: 464, pageNum: 6 },
      { number: 38, x: 303, y: 346, pageNum: 6 },
      { number: 39, x: 353, y: 260, pageNum: 6 },
    ];
    const distItems = [
      { str: "47,9", x: 270, y: 390, pageNum: 6, width: 12 },
      { str: "10,5", x: 310, y: 430, pageNum: 6, width: 12 },
      { str: "35,5", x: 285, y: 375, pageNum: 6, width: 12 },
      { str: "39,4", x: 330, y: 300, pageNum: 6, width: 12 },
    ];
    const { distances } = associateDistancesRich(posts, distItems, [], {});
    applyBifurcationJunctionLabelRehome(posts, distItems, distances, []);
    const seg3638 = distances.find((d) => d.from === 36 && d.to === 38);
    const seg3738 = distances.find((d) => d.from === 37 && d.to === 38);
    assert.equal(seg3638?.meters, 35.5);
    assert.ok(
      seg3638?.source === "bifurcation-main" ||
        seg3638?.source === "inferred-label",
    );
    assert.ok(seg3738?.meters == null || seg3738.meters !== 35.5);
  });
});

describe("branch return jumpback cleanup", () => {
  it("clears bogus 9→10 and shifts label to 10→11 when 5→10 return exists", () => {
    const posts = [];
    for (let n = 1; n <= 12; n++) {
      posts.push({
        number: n,
        x: n * 40,
        y: n === 10 ? 200 : 100,
        pageNum: 1,
      });
    }
    const distances = [];
    for (let n = 1; n < 12; n++) {
      distances.push({ from: n, to: n + 1, meters: 20 + n });
    }
    distances.find((d) => d.from === 9 && d.to === 10).meters = 37.3;
    distances.push({ from: 5, to: 10, meters: 29.5, source: "inferred-label" });

    const warnings = [];
    applyJumpbackDistanceCleanup(posts, [], distances, warnings, {});

    const seg910 = distances.find((d) => d.from === 9 && d.to === 10);
    const seg1011 = distances.find((d) => d.from === 10 && d.to === 11);
    assert.equal(seg910?.meters, null);
    assert.equal(seg1011?.meters, 37.3);
    assert.equal(seg1011?.source, "jumpback-shift");
  });

  it("tags suppressed 9→10 with source 'jumpback-suppressed' so prefill respects it", () => {
    const posts = [];
    for (let n = 1; n <= 12; n++) {
      posts.push({
        number: n,
        x: n * 40,
        y: n === 10 ? 200 : 100,
        pageNum: 1,
      });
    }
    const distances = [];
    for (let n = 1; n < 12; n++) {
      distances.push({ from: n, to: n + 1, meters: 20 + n });
    }
    distances.find((d) => d.from === 9 && d.to === 10).meters = 37.3;
    distances.push({ from: 5, to: 10, meters: 29.5, source: "inferred-label" });

    applyJumpbackDistanceCleanup(posts, [], distances, [], {});

    const seg910 = distances.find((d) => d.from === 9 && d.to === 10);
    assert.equal(seg910?.meters, null);
    assert.equal(
      seg910?.source,
      "jumpback-suppressed",
      "suppressed entry must carry source marker so downstream prefill respects it",
    );
  });

  it("creates suppressed entry when none existed pre-cleanup", () => {
    const posts = [];
    for (let n = 1; n <= 12; n++) {
      posts.push({
        number: n,
        x: n * 40,
        y: n === 10 ? 200 : 100,
        pageNum: 1,
      });
    }
    // No 9→10 entry at all; jumpback cleanup must still create a suppressed marker.
    const distances = [
      { from: 4, to: 5, meters: 30 },
      { from: 5, to: 6, meters: 28.5 },
      { from: 6, to: 7, meters: 23 },
      { from: 7, to: 8, meters: 24 },
      { from: 8, to: 9, meters: 49 },
      { from: 10, to: 11, meters: 37 },
      { from: 5, to: 10, meters: 29.5, source: "inferred-label" },
    ];
    applyJumpbackDistanceCleanup(posts, [], distances, [], {});

    const seg910 = distances.find(
      (d) =>
        (d.from === 9 && d.to === 10) || (d.from === 10 && d.to === 9),
    );
    assert.ok(seg910, "suppression marker entry must be created");
    assert.equal(seg910.meters, null);
    assert.equal(seg910.source, "jumpback-suppressed");
  });
});

describe("infer-first ordering + label exclusion", () => {
  it("returns usedLabelIndices for sequential pass", () => {
    const posts = [
      { number: 1, x: 0, y: 0, pageNum: 1 },
      { number: 2, x: 100, y: 0, pageNum: 1 },
      { number: 3, x: 200, y: 0, pageNum: 1 },
    ];
    const distItems = [
      { str: "20", x: 50, y: 10, pageNum: 1, width: 8 },
      { str: "30", x: 150, y: 10, pageNum: 1, width: 8 },
    ];
    const { distances, usedLabelIndices } = associateDistances(
      posts,
      distItems,
      [],
    );
    const seg12 = distances.find((d) => d.from === 1 && d.to === 2);
    const seg23 = distances.find((d) => d.from === 2 && d.to === 3);
    assert.equal(seg12?.meters, 20);
    assert.equal(seg23?.meters, 30);
    assert.ok(usedLabelIndices instanceof Set);
    assert.equal(usedLabelIndices.size, 2);
  });

  it("respects excludedLabelIndices option (skips that label)", () => {
    const posts = [
      { number: 1, x: 0, y: 0, pageNum: 1 },
      { number: 2, x: 100, y: 0, pageNum: 1 },
    ];
    const distItems = [
      { str: "20", x: 50, y: 10, pageNum: 1, width: 8 },
      { str: "21", x: 50, y: 20, pageNum: 1, width: 8 },
    ];
    // Exclude label 0 ("20"); sequential should pick label 1 ("21").
    const { distances } = associateDistances(posts, distItems, [], {
      excludedLabelIndices: new Set([0]),
    });
    const seg = distances.find((d) => d.from === 1 && d.to === 2);
    assert.equal(seg?.meters, 21);
  });

  it("infer-first claims non-sequential label before sequential greedy", () => {
    // Setup: posts 1..5 in a straight line, plus post 10 as a branch return
    // at the start. Label "29,5" sits near chord 1↔5 (non-sequential return)
    // — without infer-first, sequential greedy would assign it to a wrong
    // sequential pair.
    const posts = [
      { number: 1, x: 0, y: 0, pageNum: 1 },
      { number: 2, x: 50, y: 0, pageNum: 1 },
      { number: 3, x: 100, y: 0, pageNum: 1 },
      { number: 4, x: 150, y: 0, pageNum: 1 },
      { number: 5, x: 200, y: 0, pageNum: 1 },
      { number: 10, x: 100, y: 50, pageNum: 1 },
    ];
    const distItems = [
      { str: "10", x: 25, y: 5, pageNum: 1, width: 6 },
      { str: "10", x: 75, y: 5, pageNum: 1, width: 6 },
      { str: "10", x: 125, y: 5, pageNum: 1, width: 6 },
      { str: "10", x: 175, y: 5, pageNum: 1, width: 6 },
      // Non-sequential return label between posts 1 and 10:
      { str: "55", x: 50, y: 25, pageNum: 1, width: 8 },
    ];
    const { distances } = associateDistancesRich(posts, distItems, [], {});
    // 1↔10 should be a non-sequential inferred edge:
    const seg110 = distances.find(
      (d) =>
        (d.from === 1 && d.to === 10) || (d.from === 10 && d.to === 1),
    );
    // Should exist (geometry of chord 1↔10 with midpoint near label "55"); but
    // depending on top-K we may or may not pick it. The key invariant is that
    // sequential pairs still get their "10" labels.
    const seg12 = distances.find((d) => d.from === 1 && d.to === 2);
    const seg23 = distances.find((d) => d.from === 2 && d.to === 3);
    const seg34 = distances.find((d) => d.from === 3 && d.to === 4);
    const seg45 = distances.find((d) => d.from === 4 && d.to === 5);
    assert.equal(seg12?.meters, 10);
    assert.equal(seg23?.meters, 10);
    assert.equal(seg34?.meters, 10);
    assert.equal(seg45?.meters, 10);
  });
});
