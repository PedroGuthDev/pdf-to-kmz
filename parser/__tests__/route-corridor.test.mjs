import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chordSideSign,
  reflectGpsAcrossChord,
  refineGpsToPdfRouteCorridor,
} from "../geo/route-corridor.js";

describe("route-corridor", () => {
  it("reflectGpsAcrossChord mirrors across segment", () => {
    const a = { lat: -27.64, lon: -48.656 };
    const b = { lat: -27.6399, lon: -48.6552 };
    const p = { lat: -27.64, lon: -48.666 };
    const r = reflectGpsAcrossChord(a, b, p);
    const back = reflectGpsAcrossChord(a, b, r);
    assert.ok(Math.abs(back.lat - p.lat) < 1e-6);
    assert.ok(Math.abs(back.lon - p.lon) < 1e-6);
  });

  it("refineGpsToPdfRouteCorridor flips GPS when opposite PDF side", () => {
    const posts = [
      { number: 26, pageNum: 5, x: 134, y: 330, lat: -27.64007, lon: -48.65578 },
      {
        number: 27,
        pageNum: 5,
        x: 218,
        y: 304,
        lat: -27.63999,
        lon: -48.65547,
      },
      { number: 28, pageNum: 5, x: 310, y: 284, lat: -27.63992, lon: -48.65516 },
    ];
    // Push 27 to wrong side of chord in GPS (east offset)
    posts[1].lon = -48.6562;
    const w = [];
    const n = refineGpsToPdfRouteCorridor(posts, () => false, w);
    assert.equal(n, 1);
    assert.match(w[0], /post 27/);
    const sideAfter =
      (posts[2].lon - posts[0].lon) * (posts[1].lat - posts[0].lat) -
      (posts[2].lat - posts[0].lat) * (posts[1].lon - posts[0].lon);
    const sidePdf =
      (posts[2].x - posts[0].x) * (posts[1].y - posts[0].y) -
      (posts[2].y - posts[0].y) * (posts[1].x - posts[0].x);
    assert.ok(sideAfter * sidePdf > 0);
  });

  it("chordSideSign returns 0 on segment", () => {
    assert.equal(chordSideSign(0, 0, 10, 0, 5, 0), 0);
    assert.equal(chordSideSign(0, 0, 10, 0, 5, 2), 1);
  });
});
