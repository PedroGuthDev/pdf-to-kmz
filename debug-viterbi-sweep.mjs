// Viterbi σ/β sweep using debug-run-calc-revit.mjs so σ/β actually take effect.
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const args = process.argv.slice(2);
function parseList(prefix, fallback) {
  const arg = args.find(a => a.startsWith(prefix + '='));
  if (!arg) return fallback;
  return arg
    .slice(prefix.length + 1)
    .split(',')
    .map(s => Number(s.trim()))
    .filter(n => Number.isFinite(n) && n > 0);
}

const sigmas = parseList('sigma', [8, 12, 16, 20, 25, 35, 50]);
const betas = parseList('beta', [1, 3, 5, 8]);

function runRevit(sigma, beta) {
  const env = { ...process.env, VITERBI_SIGMA_PT: String(sigma), VITERBI_BETA_M: String(beta) };
  const res = spawnSync(process.execPath, ['debug-run-calc-revit.mjs'], {
    env,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  const out = res.stdout + '\n' + res.stderr;
  const maxMatch = out.match(/Max:\s*([\d.]+)m\s+<5m:\s*(\d+)\/(\d+)/);
  const offendersMatch = out.match(/Top 5 offenders:\s*(.+)/);
  if (!maxMatch) return { sigma, beta, max: NaN, lt5: 0, total: 0, top5: '(no match)' };
  return {
    sigma,
    beta,
    max: Number(maxMatch[1]),
    lt5: Number(maxMatch[2]),
    total: Number(maxMatch[3]),
    top5: offendersMatch ? offendersMatch[1].trim() : '(none)',
  };
}

console.log('sigma\tbeta\tmax(m)\t<5m\ttop5');
console.log('-'.repeat(110));
const results = [];
for (const sigma of sigmas) {
  for (const beta of betas) {
    const r = runRevit(sigma, beta);
    results.push(r);
    console.log(`${sigma}\t${beta}\t${r.max.toFixed(2)}\t${r.lt5}/${r.total}\t${r.top5}`);
  }
}
results.sort((a, b) => a.max - b.max);
console.log('\nBest (lowest max):');
for (const r of results.slice(0, 5)) {
  console.log(`  σ=${r.sigma} β=${r.beta}  max=${r.max.toFixed(2)}m  <5m=${r.lt5}/${r.total}`);
}
