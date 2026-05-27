import { projectPost, gpsBearing, destinationPoint, haversineMeters } from './parser/geo/utm-calibrator.js';

// Initial per-page transforms (before LSQ) - from buildPageTransforms log
const page3Tf = { origin_e: 730468.812, origin_n: 6940433.057, x_scale_sf: 0.354610, y_scale_sf: 0.354610, theta: 0, zone: 22 };
const page4Tf = { origin_e: 730853.311, origin_n: 6940494.151, x_scale_sf: 0.354610, y_scale_sf: 0.354610, theta: 0, zone: 22 };

// Post positions from PARSE DEBUG (new snapshot)
const p13 = { x: 1048.10, y: 160.86, pageNum: 3 };
const p14 = { x: 1139.66, y: 136.38, pageNum: 3 };
const p15 = { x: 152.42, y: 283.26, pageNum: 4 };
const p16 = { x: 247.58, y: 258.78, pageNum: 4 };

const pdfBearing = (from, to) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
};

// pdfBearing fixed (flipped Y)
const pdfBearingFixed = (from, to) => {
    const dx = to.x - from.x;
    const dy = -(to.y - from.y);
    return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
};

const utmBearing = (from, to, tf) => {
    const a = projectPost(from.x, from.y, tf);
    const b = projectPost(to.x, to.y, tf);
    return gpsBearing(a.lat, a.lon, b.lat, b.lon);
};

// What the lock function uses for prevPrev→prev (13→14 on page 3):
console.log('=== Sheet break: posts 14→15 (page 3 → page 4) ===');
console.log('Lock bearing (current/buggy pdfBearing 13→14):', pdfBearing(p13, p14).toFixed(3));
console.log('Lock bearing (pdfBearingFixed 13→14):         ', pdfBearingFixed(p13, p14).toFixed(3));
console.log('Lock bearing (UTM projected 13→14):           ', utmBearing(p13, p14, page3Tf).toFixed(3));

console.log('\n=== Sheet break: posts 25→26 (page 4 → page 5) ===');
const p24 = { x: 1037.18, y: 54.42, pageNum: 4 };
const p25 = { x: 1098.14, y: 46.38, pageNum: 4 };
console.log('Lock bearing (current/buggy pdfBearing 24→25):', pdfBearing(p24, p25).toFixed(3));
console.log('Lock bearing (pdfBearingFixed 24→25):         ', pdfBearingFixed(p24, p25).toFixed(3));
console.log('Lock bearing (UTM projected 24→25):           ', utmBearing(p24, p25, page4Tf).toFixed(3));

// What does the chain end up using? Chain uses gpsBearing(utm[i-1], utm[i]).
// For 14→15 crossing pages: prev is post 14 on page 3, curr is post 15 on page 4.
// utm[14] = projectPost(p14, page3Tf), utm[15] = projectPost(p15, page4Tf)
const u14 = projectPost(p14.x, p14.y, page3Tf);
const u15 = projectPost(p15.x, p15.y, page4Tf);
console.log('\n=== Chain bearing for 14→15 (cross-page) ===');
console.log('Chain gpsBearing(utm14, utm15):', gpsBearing(u14.lat, u14.lon, u15.lat, u15.lon).toFixed(3));
// Chain ALSO uses sequence-flip logic etc; assume no flip here

// The actual distance between u14 and u15 in meters:
console.log('Distance u14 to u15:', haversineMeters(u14.lat, u14.lon, u15.lat, u15.lon).toFixed(2), 'm');

// Simulate the lock: prev.lat (assumed = u14 here since chain runs first), walk by m=33 along bearing
const m1415 = 33; // From label
const lockUsingBuggy = destinationPoint(u14.lat, u14.lon, 104.969, m1415);
const lockUsingFixed = destinationPoint(u14.lat, u14.lon, 75.031, m1415);
const lockUsingUtm = destinationPoint(u14.lat, u14.lon, 73.865, m1415);
const chainResult = destinationPoint(u14.lat, u14.lon, 74.165, m1415);
const refPost15 = {lat: -27.64099763, lon: -48.65955950};
console.log('\n=== Simulating where post 15 would land ===');
console.log('Buggy pdfBearing lock:', `(${lockUsingBuggy.lat}, ${lockUsingBuggy.lon}) err vs ref:`, haversineMeters(refPost15.lat, refPost15.lon, lockUsingBuggy.lat, lockUsingBuggy.lon).toFixed(2));
console.log('Fixed pdfBearing lock:', `(${lockUsingFixed.lat}, ${lockUsingFixed.lon}) err vs ref:`, haversineMeters(refPost15.lat, refPost15.lon, lockUsingFixed.lat, lockUsingFixed.lon).toFixed(2));
console.log('UTM proj lock:',         `(${lockUsingUtm.lat}, ${lockUsingUtm.lon}) err vs ref:`, haversineMeters(refPost15.lat, refPost15.lon, lockUsingUtm.lat, lockUsingUtm.lon).toFixed(2));
console.log('Chain result:',          `(${chainResult.lat}, ${chainResult.lon}) err vs ref:`, haversineMeters(refPost15.lat, refPost15.lon, chainResult.lat, chainResult.lon).toFixed(2));
console.log('Original projectPost(p15,page4Tf):', `(${u15.lat}, ${u15.lon}) err vs ref:`, haversineMeters(refPost15.lat, refPost15.lon, u15.lat, u15.lon).toFixed(2));
