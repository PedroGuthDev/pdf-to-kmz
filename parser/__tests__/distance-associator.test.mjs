import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyJumpbackDistanceCleanup,
  associateDistances,
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
});
