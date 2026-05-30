import { spawnSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

const path = "./parser/geo/label-lsq-calibrator.js";
const orig = readFileSync(path, "utf8");

async function test(skipList) {
  const skipCondition = skipList.length > 0 ? `[${skipList.join(",")}].includes(post.number)` : "false";
  const target = `function tryLabelBracketPdfSnap(\r\n  prev,\r\n  post,\r\n  next,\r\n  distMap,\r\n  warnings,\r\n  opts = {},\r\n) {\r\n  const mBefore =`;
  const replacement = `function tryLabelBracketPdfSnap(\r\n  prev,\r\n  post,\r\n  next,\r\n  distMap,\r\n  warnings,\r\n  opts = {},\r\n) {\r\n  if (post && ${skipCondition}) return false;\r\n  const mBefore =`;
  const patched = orig.replace(target, replacement);
  if (patched === orig) {
    console.log("PATCH FAILED for skip:", skipList);
    return null;
  }
  writeFileSync(path, patched);
  spawnSync("node", ["debug-refresh-results.mjs"], { encoding: "utf8" });
  const r = spawnSync("node", ["debug-run-calc.mjs", "joao-born"], { encoding: "utf8" });
  const out = r.stdout;
  const errs = [];
  // Lines look like: "  ~ Post  2: err=9.46m  page=3" or "  ✓ Post 14: err=3.12m"
  const regex = /Post\s+(\d+):\s*err=([\d.]+)m/g;
  let m;
  while ((m = regex.exec(out)) !== null) {
    errs.push({ num: +m[1], err: +m[2] });
  }
  const max = errs.length > 0 ? Math.max(...errs.map(e => e.err)) : -1;
  const under5 = errs.filter(e => e.err < 5).length;
  const under7 = errs.filter(e => e.err < 7).length;
  return { skipList, max, under5, under7, errs };
}

const cases = [
  [],
  [2],
  [12],
  [2, 12],
  [8, 12, 19, 22, 23, 24, 33],
  [2, 8, 12, 19, 22, 23, 24, 33],
  [2, 12, 33],  // skip only the most label-inconsistent
];

for (const skip of cases) {
  const r = await test(skip);
  if (!r) continue;
  console.log(`skip=[${skip.join(",")}]: max=${r.max.toFixed(2)} <5m=${r.under5} <7m=${r.under7}`);
  const top = [...r.errs].sort((a, b) => b.err - a.err).slice(0, 5);
  console.log(`  top 5: ${top.map(t => `${t.num}:${t.err.toFixed(1)}`).join(' ')}`);
}

writeFileSync(path, orig);
console.log("(restored)");
