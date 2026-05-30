// Try skipping snap for specific posts and see effects
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

const path = "./parser/geo/label-lsq-calibrator.js";
const orig = readFileSync(path, "utf8");

// Function to test a specific skip set
async function test(skipList) {
  const skipCondition = skipList.length > 0 ? `[${skipList.join(",")}].includes(post.number)` : "false";
  const target = `function tryLabelBracketPdfSnap(\r\n  prev,\r\n  post,\r\n  next,\r\n  distMap,\r\n  warnings,\r\n  opts = {},\r\n) {\r\n  const mBefore =`;
  const replacement = `function tryLabelBracketPdfSnap(\r\n  prev,\r\n  post,\r\n  next,\r\n  distMap,\r\n  warnings,\r\n  opts = {},\r\n) {\r\n  if (post && ${skipCondition}) return false;\r\n  const mBefore =`;
  const patched = orig.replace(target, replacement);
  writeFileSync(path, patched);
  spawnSync("node", ["debug-refresh-results.mjs"], { encoding: "utf8" });
  const r = spawnSync("node", ["debug-run-calc.mjs", "joao-born"], { encoding: "utf8" });
  const out = r.stdout;
  const errs = [];
  for (let i = 1; i <= 34; i++) {
    const num = String(i).padStart(2, ' ');
    const m = out.match(new RegExp(`Post ${num}: err=([\d.]+)m`));
    if (m) errs.push({ num: i, err: parseFloat(m[1]) });
  }
  const max = Math.max(...errs.map(e => e.err));
  const under5 = errs.filter(e => e.err < 5).length;
  const under7 = errs.filter(e => e.err < 7).length;
  return { skipList, max, under5, under7, errs };
}

const cases = [
  [],
  [2],
  [12],
  [2, 12],
  [8, 12, 19, 22, 23, 24, 33],  // All current on-cable snaps
  [2, 8, 12, 19, 22, 23, 24, 33],
];

for (const skip of cases) {
  const r = await test(skip);
  console.log(`skip=[${skip.join(",")}]: max=${r.max.toFixed(2)} <5m=${r.under5} <7m=${r.under7}`);
  const top = [...r.errs].sort((a, b) => b.err - a.err).slice(0, 5);
  console.log(`  top 5: ${top.map(t => `${t.num}:${t.err.toFixed(1)}`).join(' ')}`);
}

writeFileSync(path, orig);
