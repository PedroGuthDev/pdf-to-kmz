import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { associateDistances } from "../distance-associator.js";

describe("distance-associator cross-page labels", () => {
  it("assigns sheet-edge label on incoming page to cross-page segment", () => {
    const posts = [
      { number: 25, x: 200, y: 120, pageNum: 4 },
      { number: 26, x: 848, y: 167, pageNum: 5 },
      { number: 34, x: 134, y: 330, pageNum: 5 },
    ];
    const distItems = [
      { str: "33,7", x: 88, y: 363, pageNum: 5, width: 11.4 },
    ];
    const { distances } = associateDistances(posts, distItems, []);
    const seg = distances.find((d) => d.from === 25 && d.to === 26);
    assert.equal(seg?.meters, 33.7);
  });
});
