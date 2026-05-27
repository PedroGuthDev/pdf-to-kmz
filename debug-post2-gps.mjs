// What is post 2's PDF→UTM projection vs reference?
import { parsePdf } from "./parser/pdf-parser.js";
import { calculateCoordinates } from "./parser/coordinate-calculator.js";
import { readFileSync } from "fs";
import { spawnSync } from "child_process";

// Use the harness for consistency
const out = spawnSync("node", ["debug-run-calc.mjs", "joao-born"], { encoding: "utf8" });
const stdout = out.stdout;
// Find the final post 2 lat/lon — actually we'd need to expose that. Let's compute via test code:

// Compute project for post 2 with current page-3 transform
const sf = 0.354610;
const theta_p3 = 0; // page 3 theta=0
const origin_e = 730468.812;
const origin_n = 6940433.057;
const post2_x = 342.38, post2_y = 428.82;
// transform: e = origin_e + x*sf*cos(theta) + y*sf*sin(theta)
//           n = origin_n - y*sf*cos(theta) + x*sf*sin(theta)
// since theta=0:
const e2 = origin_e + post2_x * sf;
const n2 = origin_n - post2_y * sf;
console.log(`post 2 projected UTM: (${e2.toFixed(2)}, ${n2.toFixed(2)})`);

// Reference post 2 UTM
import { latLonToUtm } from "./parser/geo/utm-calibrator.js";
const ref2 = latLonToUtm(-27.64189640868478, -48.66274618461442, 22);
console.log(`reference post 2 UTM: (${ref2.e.toFixed(2)}, ${ref2.n.toFixed(2)})`);
const de = e2 - ref2.e;
const dn = n2 - ref2.n;
console.log(`delta (proj - ref): de=${de.toFixed(2)} dn=${dn.toFixed(2)} mag=${Math.hypot(de, dn).toFixed(2)}`);

// Also for post 1 and 3
const post1_x = 272.66, post1_y = 444.30;
const e1 = origin_e + post1_x * sf;
const n1 = origin_n - post1_y * sf;
const ref1 = latLonToUtm(-27.641966601540403, -48.66305968585957, 22);
console.log(`post 1: proj (${e1.toFixed(2)}, ${n1.toFixed(2)}) ref (${ref1.e.toFixed(2)}, ${ref1.n.toFixed(2)}) Δ(${(e1-ref1.e).toFixed(2)},${(n1-ref1.n).toFixed(2)})`);

const post3_x = 436.82, post3_y = 396.78;
const e3 = origin_e + post3_x * sf;
const n3 = origin_n - post3_y * sf;
const ref3 = latLonToUtm(-27.641835371382406, -48.66249641713888, 22);
console.log(`post 3: proj (${e3.toFixed(2)}, ${n3.toFixed(2)}) ref (${ref3.e.toFixed(2)}, ${ref3.n.toFixed(2)}) Δ(${(e3-ref3.e).toFixed(2)},${(n3-ref3.n).toFixed(2)})`);

// Vector from post 1 to post 3 in PDF and UTM
const dx_pdf = post3_x - post1_x;
const dy_pdf = post3_y - post1_y;
const dx_utm = ref3.e - ref1.e;
const dy_utm = ref3.n - ref1.n;
console.log(`PDF 1->3: dx=${dx_pdf.toFixed(2)} dy=${dy_pdf.toFixed(2)} (scaled: dE=${(dx_pdf*sf).toFixed(2)} dN=${(-dy_pdf*sf).toFixed(2)})`);
console.log(`UTM 1->3: dE=${dx_utm.toFixed(2)} dN=${dy_utm.toFixed(2)}`);
// The UTM 1->3 bearing
console.log(`UTM bearing 1->3: ${(Math.atan2(dx_utm, dy_utm) * 180 / Math.PI).toFixed(2)}°`);
// The PDF 1->3 bearing (with y flipped to north)
console.log(`PDF bearing 1->3: ${(Math.atan2(dx_pdf, -dy_pdf) * 180 / Math.PI).toFixed(2)}°`);

// And from 1 to 2
const ref2_e_minus_ref1_e = ref2.e - ref1.e;
const ref2_n_minus_ref1_n = ref2.n - ref1.n;
console.log(`UTM bearing 1->2: ${(Math.atan2(ref2_e_minus_ref1_e, ref2_n_minus_ref1_n) * 180 / Math.PI).toFixed(2)}° dist=${Math.hypot(ref2_e_minus_ref1_e, ref2_n_minus_ref1_n).toFixed(2)}m`);
