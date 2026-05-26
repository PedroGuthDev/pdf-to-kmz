import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { associateDistances } from "../distance-associator.js";

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
