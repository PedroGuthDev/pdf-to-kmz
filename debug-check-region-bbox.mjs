import { readFileSync } from "node:fs";
import { parseDxfText } from "./parser/dwg/dxf-loader.js";
import { utmToLatLon, latLonToUtm } from "./parser/geo/utm-calibrator.js";

const text = readFileSync("Palhoca.dxf", "utf8");
const parsed = parseDxfText(text);
const { posts, extmin, extmax } = parsed;
console.log("posts:", posts.length);
console.log("EXTMIN:", extmin, "EXTMAX:", extmax);

const zone = 22;
const ll0 = utmToLatLon(extmin.x, extmin.y, zone);
const ll1 = utmToLatLon(extmax.x, extmax.y, zone);
const bbox = {
  minLat: Math.min(ll0.lat, ll1.lat), maxLat: Math.max(ll0.lat, ll1.lat),
  minLon: Math.min(ll0.lon, ll1.lon), maxLon: Math.max(ll0.lon, ll1.lon),
};
console.log("bboxLatLon from EXTMIN/EXTMAX:", bbox);

let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;
for (const p of posts) {
  minE = Math.min(minE, p.x); maxE = Math.max(maxE, p.x);
  minN = Math.min(minN, p.y); maxN = Math.max(maxN, p.y);
}
const pl0 = utmToLatLon(minE, minN, zone), pl1 = utmToLatLon(maxE, maxN, zone);
console.log("posts UTM bbox:", { minE, maxE, minN, maxN });
console.log("posts latlon bbox:", {
  minLat: Math.min(pl0.lat, pl1.lat), maxLat: Math.max(pl0.lat, pl1.lat),
  minLon: Math.min(pl0.lon, pl1.lon), maxLon: Math.max(pl0.lon, pl1.lon),
});

const lat = -27.638495227353626, lon = -48.685947734750364;
const inside = lat >= bbox.minLat && lat <= bbox.maxLat && lon >= bbox.minLon && lon <= bbox.maxLon;
console.log("user point:", { lat, lon }, "inside header bbox?", inside);

const utm = latLonToUtm(lat, lon, zone);
console.log("user point in UTM zone 22S:", utm);

const ux = utm.easting ?? utm.e ?? utm.x;
const uy = utm.northing ?? utm.n ?? utm.y;
let best = null, bd = Infinity;
for (const p of posts) {
  const d = Math.hypot(p.x - ux, p.y - uy);
  if (d < bd) { bd = d; best = p; }
}
console.log("nearest DXF post:", best, "dist m:", bd.toFixed(1));
