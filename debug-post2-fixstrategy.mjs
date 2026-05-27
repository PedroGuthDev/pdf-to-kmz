import { latLonToUtm, utmToLatLon } from "./parser/geo/utm-calibrator.js";

const sf = 0.354610;
const origin_e = 730468.812;
const origin_n = 6940433.057;
const ref2 = latLonToUtm(-27.64189640868478, -48.66274618461442);

// Strategy: use UTM-derived chord ratio
const x = 363.77, y = 417.92;
const e = origin_e + x * sf;
const n = origin_n - y * sf;
const err = Math.hypot(e - ref2.easting, n - ref2.northing);
console.log(`Strategy 1 (UTM chord ratio): PDF (${x.toFixed(2)}, ${y.toFixed(2)}) → UTM (${e.toFixed(2)}, ${n.toFixed(2)}) err=${err.toFixed(2)}m`);

// What if we apply this AS GPS BIAS, like distortion-zone does?
// Current post 2 projects to (730590.22, 6940280.99) — 6.59m from ref.
// If we project the "corrected PDF position" but keep it as a GPS bias:
// target_e = 730599.84, target_n = 6940282.79, ref = (730596.59, 6940282.70)
// err vs ref = 3.27m
