// Diagnostic: is Luiz Carolino PDF error a rigid per-segment offset (calibration)
// or a deformation (chain mis-association from a stolen/branch label)?
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { runRoutePdfAccuracyHarness } from "./tools/route-pdf-accuracy-harness.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF = path.join(__dirname, "INFOVIAS_AAF INTERNET_São José_RUA LUIZ CAROLINO PEREIRA_v1.pdf");
const GT = path.join(__dirname, "parser/__tests__/fixtures/luizcarolino-ground-truth.json");

const truth = JSON.parse(readFileSync(GT, "utf8"));
const truthByNum = new Map(truth.map((g) => [g.number, g]));

const { posts, errorsByPost } = await runRoutePdfAccuracyHarness({ pdfPath: PDF, groundTruthPath: GT });
const predByNum = new Map(posts.map((p) => [p.number, p]));

// local meters-per-degree at this latitude
const lat0 = truth[0].lat;
const mPerLat = 111320;
const mPerLon = 111320 * Math.cos((lat0 * Math.PI) / 180);

function offset(n) {
  const t = truthByNum.get(n), p = predByNum.get(n);
  if (!t || !p || p.lat == null) return null;
  const de = (p.lon - t.lon) * mPerLon; // east error (m)
  const dn = (p.lat - t.lat) * mPerLat; // north error (m)
  return { de, dn, mag: Math.hypot(de, dn), brg: (Math.atan2(de, dn) * 180 / Math.PI + 360) % 360 };
}

function segReport(lo, hi) {
  const rows = [];
  for (let n = lo; n <= hi; n++) { const o = offset(n); if (o) rows.push({ n, ...o }); }
  if (!rows.length) return;
  const mde = rows.reduce((s, r) => s + r.de, 0) / rows.length;
  const mdn = rows.reduce((s, r) => s + r.dn, 0) / rows.length;
  // residual after removing the mean offset = the deformation component
  const resid = rows.map((r) => Math.hypot(r.de - mde, r.dn - mdn));
  const meanResid = resid.reduce((s, x) => s + x, 0) / resid.length;
  const maxResid = Math.max(...resid);
  console.log(`\n=== segment ${lo}-${hi} ===`);
  console.log(`mean offset vector: ${Math.hypot(mde, mdn).toFixed(1)} m @ ${((Math.atan2(mde, mdn) * 180 / Math.PI + 360) % 360).toFixed(0)}deg`);
  console.log(`residual after removing rigid offset: mean ${meanResid.toFixed(1)} m, max ${maxResid.toFixed(1)} m`);
  console.log("post  err   offsetMag  bearing  residual");
  rows.forEach((r, i) => console.log(`${String(r.n).padStart(3)}  ${r.mag.toFixed(0).padStart(4)}  ${r.mag.toFixed(0).padStart(8)}  ${r.brg.toFixed(0).padStart(6)}  ${resid[i].toFixed(1).padStart(6)}`));
}

segReport(1, 20);
segReport(21, 31);
