import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chordSideSign,
  clampGpsToRouteCableCorridor,
  gpsChordSide,
  lateralMetersChord,
  reflectGpsAcrossChord,
  refineGpsAtSheetBreakCorridor,
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

  it("refineGpsToPdfRouteCorridor uses route neighbors when immediate are auxiliary", () => {
    const posts = [
      { number: 3, pageNum: 3, x: 0, y: 0, lat: -27.64, lon: -48.656 },
      { number: 5, pageNum: 3, x: 20, y: 2, lat: -27.6398, lon: -48.6558 },
      { number: 6, pageNum: 3, x: 50, y: 8, lat: -27.6399, lon: -48.65547 },
      { number: 7, pageNum: 3, x: 70, y: 2, lat: -27.63985, lon: -48.6554 },
      { number: 8, pageNum: 3, x: 100, y: 0, lat: -27.63992, lon: -48.65516 },
    ];
    // GPS on opposite side of 3–8 chord; immediate neighbors 5–7 are auxiliary.
    posts[2].lat = -27.6405;
    const w = [];
    const n = refineGpsToPdfRouteCorridor(
      posts,
      (p) => p.number === 5 || p.number === 7,
      w,
    );
    assert.equal(n, 1);
    assert.match(w[0], /post 6/);
    assert.match(w[0], /via route posts 3–8/);
  });

  it("refineGpsToPdfRouteCorridor skips reflection when one immediate neighbor is auxiliary", () => {
    const posts = [
      { number: 2, pageNum: 3, x: 0, y: 0, lat: -27.64, lon: -48.656 },
      { number: 3, pageNum: 3, x: 40, y: 6, lat: -27.6399, lon: -48.6555 },
      { number: 4, pageNum: 3, x: 60, y: 2, lat: -27.63985, lon: -48.6554 },
      { number: 5, pageNum: 3, x: 100, y: 0, lat: -27.63992, lon: -48.65516 },
    ];
    posts[1].lat = -27.6405;
    const w = [];
    const n = refineGpsToPdfRouteCorridor(posts, (p) => p.number === 4, w);
    assert.equal(n, 0);
  });

  it("refineGpsToPdfRouteCorridor flips GPS when opposite PDF side", () => {
    const posts = [
      {
        number: 26,
        pageNum: 5,
        x: 134,
        y: 330,
        lat: -27.64007,
        lon: -48.65578,
      },
      {
        number: 27,
        pageNum: 5,
        x: 218,
        y: 304,
        lat: -27.63999,
        lon: -48.65547,
      },
      {
        number: 28,
        pageNum: 5,
        x: 310,
        y: 284,
        lat: -27.63992,
        lon: -48.65516,
      },
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

  it("refineGpsAtSheetBreakCorridor flips incoming page when GPS mirrors at break", () => {
    const cablesByPage = new Map([
      [
        4,
        [
          [
            { type: "M", x: 0, y: 0 },
            { type: "L", x: 200, y: 0 },
          ],
        ],
      ],
      [
        5,
        [
          [
            { type: "M", x: 0, y: 0 },
            { type: "L", x: 200, y: 0 },
          ],
        ],
      ],
    ]);
    const posts = [
      { number: 24, pageNum: 4, x: 100, y: 10, lat: -27.64, lon: -48.656 },
      { number: 25, pageNum: 4, x: 120, y: 10, lat: -27.6401, lon: -48.6555 },
      { number: 26, pageNum: 5, x: 140, y: 10, lat: -27.6399, lon: -48.6556 },
      { number: 27, pageNum: 5, x: 160, y: 10, lat: -27.6403, lon: -48.6554 },
    ];
    // GPS on opposite side of 24–27 chord on page 5 while PDF stays same cable side (y=10)
    posts[2].lat = -27.642;
    posts[2].lon = -48.6565;
    const w = [];
    const n = refineGpsAtSheetBreakCorridor(
      posts,
      cablesByPage,
      () => false,
      w,
    );
    assert.ok(n >= 2);
    const a = { lat: posts[0].lat, lon: posts[0].lon };
    const b = { lat: posts[3].lat, lon: posts[3].lon };
    assert.equal(
      gpsChordSide(a, b, { lat: posts[1].lat, lon: posts[1].lon }),
      gpsChordSide(a, b, { lat: posts[2].lat, lon: posts[2].lon }),
    );
  });

  it("clampGpsToRouteCableCorridor shrinks lateral offset beyond 8 m", () => {
    const cablesByPage = new Map();
    const pageTransforms = new Map([
      [
        1,
        {
          origin_e: 500000,
          origin_n: 6940000,
          x_scale_sf: 0.05,
          y_scale_sf: 0.05,
          zone: 22,
          theta: 0,
        },
      ],
    ]);
    const posts = [
      { number: 1, pageNum: 1, x: 0, y: 0, lat: -27.64, lon: -48.656 },
      { number: 2, pageNum: 1, x: 100, y: 0, lat: -27.639, lon: -48.662 },
      { number: 3, pageNum: 1, x: 200, y: 0, lat: -27.638, lon: -48.654 },
    ];
    const w = [];
    const n = clampGpsToRouteCableCorridor(
      posts,
      cablesByPage,
      pageTransforms,
      () => false,
      w,
      { maxLateralM: 8 },
    );
    assert.equal(n, 1);
    const lateral = lateralMetersChord(
      { lat: posts[0].lat, lon: posts[0].lon },
      { lat: posts[2].lat, lon: posts[2].lon },
      { lat: posts[1].lat, lon: posts[1].lon },
    );
    assert.ok(lateral <= 8.5);
    assert.match(w[0], /lateral clamp/);
  });
});
