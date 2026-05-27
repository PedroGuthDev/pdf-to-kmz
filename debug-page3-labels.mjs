import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);

const distMap = new Map();
for (const d of parsed.distances) {
  distMap.set(`${d.from}->${d.to}`, d.meters);
}

console.log("Page 3 labels:");
for (let n = 1; n <= 14; n++) {
  const fwd = distMap.get(`${n}->${n+1}`);
  const back = distMap.get(`${n+1}->${n}`);
  console.log(`  ${n}->${n+1}: ${fwd ?? "MISSING"} (or back ${back ?? "missing"})`);
}

// Try tryLabelBracketPdfSnap conditions for post 4 and post 5
import { isOffRouteCablePost, buildCablesByPage } from "./parser/cable-builder.js";
const sorted = [...parsed.posts].sort((a, b) => a.number - b.number);
const cablesByPage = buildCablesByPage(parsed.cableSegments);
const postByNum = new Map(sorted.map((p) => [p.number, p]));

const LABEL_BRACKET_CHORD_DELTA_M = 4;
const LABEL_BRACKET_CHORD_RATIO = 1.4;
const LABEL_BRACKET_MIN_MOVE_PT = 5;

function tryLabelBracketCheck(prev, post, next, scale) {
  const mBefore = distMap.get(`${prev.number}->${post.number}`);
  const mAfter = distMap.get(`${post.number}->${next.number}`);
  if (mBefore == null || mAfter == null) return "missing labels";
  const chordBeforePt = Math.hypot(post.x - prev.x, post.y - prev.y);
  const chordAfterPt = Math.hypot(next.x - post.x, next.y - post.y);
  const chordBefore = chordBeforePt * scale; // in meters
  const chordAfter = chordAfterPt * scale;
  const ratioBefore = chordBefore > 0.5 ? chordBefore / mBefore : 0;
  const ratioAfter = chordAfter > 0.5 ? chordAfter / mAfter : 0;
  const needsBefore =
    Math.abs(chordBefore - mBefore) >= LABEL_BRACKET_CHORD_DELTA_M ||
    ratioBefore < 1 / LABEL_BRACKET_CHORD_RATIO ||
    ratioBefore > LABEL_BRACKET_CHORD_RATIO;
  const needsAfter =
    Math.abs(chordAfter - mAfter) >= LABEL_BRACKET_CHORD_DELTA_M ||
    ratioAfter < 1 / LABEL_BRACKET_CHORD_RATIO ||
    ratioAfter > LABEL_BRACKET_CHORD_RATIO;

  const chainM = mBefore + mAfter;
  const frac = mBefore / chainM;
  const snapX = prev.x + frac * (next.x - prev.x);
  const snapY = prev.y + frac * (next.y - prev.y);
  const movePt = Math.hypot(post.x - snapX, post.y - snapY);

  const newChordBeforePt = Math.hypot(snapX - prev.x, snapY - prev.y);
  const newChordAfterPt = Math.hypot(next.x - snapX, next.y - snapY);
  const newChordBefore = newChordBeforePt * scale;
  const newChordAfter = newChordAfterPt * scale;
  const improved =
    Math.abs(newChordBefore - mBefore) + Math.abs(newChordAfter - mAfter) <
    Math.abs(chordBefore - mBefore) + Math.abs(chordAfter - mAfter);

  return {
    chordBeforeM: chordBefore.toFixed(1),
    mBefore,
    chordAfterM: chordAfter.toFixed(1),
    mAfter,
    ratioBefore: ratioBefore.toFixed(2),
    ratioAfter: ratioAfter.toFixed(2),
    needsBefore,
    needsAfter,
    snapXY: `(${snapX.toFixed(1)}, ${snapY.toFixed(1)})`,
    movePt: movePt.toFixed(1),
    minMovePt: LABEL_BRACKET_MIN_MOVE_PT,
    improved,
  };
}

const PAGE_3_SCALE = 0.354610;
console.log("\nLabel-bracket check for taps using PAGE-3 scale:");
console.log("Post 4 (3,4,5):", tryLabelBracketCheck(
  sorted.find((p) => p.number === 3),
  sorted.find((p) => p.number === 4),
  sorted.find((p) => p.number === 5),
  PAGE_3_SCALE,
));
console.log("Post 5 (4,5,6):", tryLabelBracketCheck(
  sorted.find((p) => p.number === 4),
  sorted.find((p) => p.number === 5),
  sorted.find((p) => p.number === 6),
  PAGE_3_SCALE,
));
console.log("Post 7 (6,7,8):", tryLabelBracketCheck(
  sorted.find((p) => p.number === 6),
  sorted.find((p) => p.number === 7),
  sorted.find((p) => p.number === 8),
  PAGE_3_SCALE,
));
