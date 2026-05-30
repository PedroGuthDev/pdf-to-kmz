// If we have projected post 3 at 2.10m err, and we use midpoint of projected p1, projected p3, what do we get for post 2?
import { latLonToUtm, utmToLatLon } from "./parser/geo/utm-calibrator.js";

// Projected p1 = ref1 (anchor 0.05m err)
// Projected p3 — actual harness GPS. Let me reverse-engineer it.
// post 3 ref: -27.641835371382406, -48.66249641713888
// post 3 err: 2.10m
// We need actual projected lat/lon. Let me run the harness and extract it.

// For now, approximate: assume projected p3 is ~2m off ref3 in some direction.
const ref1 = { lat: -27.641966601540403, lon: -48.66305968585957 };
const ref2 = { lat: -27.64189640868478, lon: -48.66274618461442 };
const ref3 = { lat: -27.641835371382406, lon: -48.66249641713888 };
const u1 = latLonToUtm(ref1.lat, ref1.lon);
const u2 = latLonToUtm(ref2.lat, ref2.lon);
const u3 = latLonToUtm(ref3.lat, ref3.lon);

// What does corridor-corrected post 3 look like?
// Let's assume it's a similar 2m shift in the same direction as the pipeline produces
// For testing: if we use the simple midpoint with the IDEAL ref1 and ref3:
const ideal_mid = { e: (u1.easting + u3.easting) / 2, n: (u1.northing + u3.northing) / 2 };
console.log(`ideal midpoint of u1, u3: (${ideal_mid.e.toFixed(2)}, ${ideal_mid.n.toFixed(2)}) err vs u2: ${Math.hypot(ideal_mid.e - u2.easting, ideal_mid.n - u2.northing).toFixed(2)}m`);

// Compare to current: post 2 PDF projects to ~9.46m off via current pipeline
// With anchor-refit: post 2 projects to ~7.28m

// IDEA: if the PROJECTED post 1 and post 3 (after all pipeline steps) are both reasonable,
// use linear interpolation between them. But what's the interpolation fraction?
// PDF chord fraction = 0.418 → 7.9m err
// Label fraction = 0.378 → 10.2m err  
// Midpoint (frac=0.5) → 3.2m err 
// True frac (UTM): u1->u2 / u1->u3 = 31.91 / 57.47 = 0.555 → 0.5m err (theoretical)
const true_frac = 31.91 / 57.47;
const test = { e: u1.easting + true_frac * (u3.easting - u1.easting), n: u1.northing + true_frac * (u3.northing - u1.northing) };
console.log(`true-frac (UTM): ${true_frac.toFixed(3)} → err: ${Math.hypot(test.e - u2.easting, test.n - u2.northing).toFixed(2)}m`);

// The fraction we need is ~0.55 (not 0.42 PDF or 0.38 label).
// Where does this come from? The cable curves between 1 and 3 — the cable PATH from 1 to 3 is LONGER than the chord, so post 2 along the cable should be further along.
// IDEA: use the cable PATH length, not the chord length!
