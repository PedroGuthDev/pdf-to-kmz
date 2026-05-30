import { latLonToUtm } from "./parser/geo/utm-calibrator.js";

// Post 25: PDF (1133.90, 51.84) on page 4
// What's post 25's actual error vs reference?
// We know: err=7.29m

// Page 4 transform after LSQ:
// origin_e=730853.311, origin_n=6940494.151, sf=0.354610, theta=-0.20°
// But wait — anchor refit only fires on page 3. Page 4 has theta=-0.20° from label-lsq.

const sf = 0.354610;
const theta = -0.20 * Math.PI / 180;
const origin_e = 730853.311;
const origin_n = 6940494.151;
// theta adjustment shifts origin somehow. Let me skip the exact transform and check what current projected post 25 is.

// From earlier query (debug_results.txt):
// Post 25: ref=-27.64015531, -48.65610926; calc=-27.64022064, -48.65611567; err=7.29m
const refU25 = latLonToUtm(-27.64015531, -48.65610926);
const calcU25 = latLonToUtm(-27.64022064, -48.65611567);
console.log(`Post 25 ref: (${refU25.easting.toFixed(2)}, ${refU25.northing.toFixed(2)})`);
console.log(`Post 25 calc: (${calcU25.easting.toFixed(2)}, ${calcU25.northing.toFixed(2)})`);
console.log(`Delta: dE=${(calcU25.easting - refU25.easting).toFixed(2)} dN=${(calcU25.northing - refU25.northing).toFixed(2)}`);

// Reference 24 and 25:
const refU24 = latLonToUtm(-27.64023160, -48.65643999);
const refU26 = latLonToUtm(-27.64006833, -48.65577853);
console.log(`Ref 24->25: dE=${(refU25.easting - refU24.easting).toFixed(2)} dN=${(refU25.northing - refU24.northing).toFixed(2)} dist=${Math.hypot(refU25.easting - refU24.easting, refU25.northing - refU24.northing).toFixed(2)}m`);
console.log(`Ref 25->26: dE=${(refU26.easting - refU25.easting).toFixed(2)} dN=${(refU26.northing - refU25.northing).toFixed(2)} dist=${Math.hypot(refU26.easting - refU25.easting, refU26.northing - refU25.northing).toFixed(2)}m`);

// Calc 24, 26:
const calcU24 = latLonToUtm(-27.64029822, -48.65645219);
const calcU26 = latLonToUtm(-27.64007082, -48.65578084);
console.log(`Calc 24->25: dE=${(calcU25.easting - calcU24.easting).toFixed(2)} dN=${(calcU25.northing - calcU24.northing).toFixed(2)} dist=${Math.hypot(calcU25.easting - calcU24.easting, calcU25.northing - calcU24.northing).toFixed(2)}m`);
console.log(`Calc 25->26: dE=${(calcU26.easting - calcU25.easting).toFixed(2)} dN=${(calcU26.northing - calcU25.northing).toFixed(2)} dist=${Math.hypot(calcU26.easting - calcU25.easting, calcU26.northing - calcU25.northing).toFixed(2)}m`);

// Errors per post (just for context):
const calcU23 = latLonToUtm(-27.64033361, -48.65676823);
const refU23 = latLonToUtm(-27.64028806, -48.65679655);
console.log(`Post 23 err: dE=${(calcU23.easting - refU23.easting).toFixed(2)} dN=${(calcU23.northing - refU23.northing).toFixed(2)} mag=${Math.hypot(calcU23.easting - refU23.easting, calcU23.northing - refU23.northing).toFixed(2)}m`);
console.log(`Post 24 err: dE=${(calcU24.easting - refU24.easting).toFixed(2)} dN=${(calcU24.northing - refU24.northing).toFixed(2)} mag=${Math.hypot(calcU24.easting - refU24.easting, calcU24.northing - refU24.northing).toFixed(2)}m`);
console.log(`Post 25 err: dE=${(calcU25.easting - refU25.easting).toFixed(2)} dN=${(calcU25.northing - refU25.northing).toFixed(2)} mag=${Math.hypot(calcU25.easting - refU25.easting, calcU25.northing - refU25.northing).toFixed(2)}m`);
console.log(`Post 26 err: dE=${(calcU26.easting - refU26.easting).toFixed(2)} dN=${(calcU26.northing - refU26.northing).toFixed(2)} mag=${Math.hypot(calcU26.easting - refU26.easting, calcU26.northing - refU26.northing).toFixed(2)}m`);
