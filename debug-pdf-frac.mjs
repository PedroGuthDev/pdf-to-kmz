// What's the PDF position of post 2 if we use PDF-chord fraction 0.418?
const p1 = { x: 272.66, y: 444.30 };
const p3 = { x: 436.82, y: 396.78 };
const frac = 0.418;
const p2 = { x: p1.x + frac * (p3.x - p1.x), y: p1.y + frac * (p3.y - p1.y) };
console.log(`post 2 at PDF chord frac ${frac}: (${p2.x.toFixed(2)}, ${p2.y.toFixed(2)})`);

// And what about by sequence chord (post 2 at frac 0.5)?
const p2_mid = { x: p1.x + 0.5 * (p3.x - p1.x), y: p1.y + 0.5 * (p3.y - p1.y) };
console.log(`post 2 at PDF chord frac 0.5: (${p2_mid.x.toFixed(2)}, ${p2_mid.y.toFixed(2)})`);

// And current (label frac 0.378):
const p2_cur = { x: p1.x + 0.378 * (p3.x - p1.x), y: p1.y + 0.378 * (p3.y - p1.y) };
console.log(`post 2 at label frac 0.378: (${p2_cur.x.toFixed(2)}, ${p2_cur.y.toFixed(2)})`);

// And the current actual PDF position:
console.log(`current actual PDF post 2: (342.38, 428.82)`);
// Notice it's at chord frac:
const dx = 342.38 - p1.x, dy = 428.82 - p1.y;
const total_dx = p3.x - p1.x, total_dy = p3.y - p1.y;
const t = (dx * total_dx + dy * total_dy) / (total_dx * total_dx + total_dy * total_dy);
console.log(`current post 2 t along PDF chord: ${t.toFixed(3)} (perpendicular: ${(Math.abs(dx * total_dy - dy * total_dx) / Math.hypot(total_dx, total_dy)).toFixed(2)}pt)`);
