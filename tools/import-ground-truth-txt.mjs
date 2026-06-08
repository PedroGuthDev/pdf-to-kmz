#!/usr/bin/env node
/**
 * Import repo-root GPS coordinate .txt files into ground-truth JSON fixtures (D-02).
 *
 * Parses `Poste NN; lat, lon;` (case-insensitive, trailing `;` optional), skips blank
 * lines, and excludes coordinate outliers whose haversine distance from the route
 * cluster median exceeds --outlier-km (default 2.0 km) — e.g. João Born post 35
 * carries Siriu coordinates ~37 km off.
 *
 * Run:  node tools/import-ground-truth-txt.mjs [--outlier-km=2.0]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { haversineMeters } from "../parser/geo/utm-calibrator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "parser", "__tests__", "fixtures");

const ROUTES = [
  {
    name: "siriu",
    txt: path.join(ROOT, "coordenadas postes siriu.txt"),
    out: path.join(FIXTURES, "siriu-ground-truth.json"),
  },
  {
    name: "luizcarolino",
    txt: path.join(ROOT, "coordenadas postes rua luiz carolino pereira..txt"),
    out: path.join(FIXTURES, "luizcarolino-ground-truth.json"),
  },
  {
    name: "joaoborn",
    txt: path.join(ROOT, "coordenadas postes rua joao born.txt"),
    out: path.join(FIXTURES, "joaoborn-ground-truth.json"),
  },
  {
    name: "valmor",
    txt: path.join(ROOT, "coordenadas postes rua valmor.txt"),
    out: path.join(FIXTURES, "valmor-ground-truth.json"),
  },
];

function parseOutlierKm(argv) {
  for (const arg of argv) {
    const m = arg.match(/^--outlier-km=(.+)$/);
    if (m) return Number(m[1]);
  }
  return 2.0;
}

function median(values) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function parseTxtLines(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/poste\s+(\d+)\s*;\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
    if (!m) continue;
    out.push({ number: +m[1], lat: +m[2], lon: +m[3] });
  }
  return out;
}

function excludeOutliers(posts, outlierKm) {
  if (!posts.length) return { kept: [], excluded: 0 };
  // NOTE: center is computed as the component-wise lat/lon median (not a geometric medoid).
  // For L-shaped or curved routes this synthetic point may sit off the route, inflating distances
  // for legitimate posts at the extremities. Keep --outlier-km coarse (default 2.0 km) to avoid
  // excluding valid endpoints. Use a real medoid if stricter outlier rejection is needed.
  const medianLat = median(posts.map((p) => p.lat));
  const medianLon = median(posts.map((p) => p.lon));
  const thresholdM = outlierKm * 1000;
  const kept = [];
  let excluded = 0;
  for (const p of posts) {
    const distM = haversineMeters(p.lat, p.lon, medianLat, medianLon);
    if (distM > thresholdM) {
      const distKm = distM / 1000;
      console.error(
        `EXCLUDED post ${p.number} (outlier: ${distKm.toFixed(1)} km from route cluster)`,
      );
      excluded++;
    } else {
      kept.push(p);
    }
  }
  return { kept, excluded };
}

function importRoute(route, outlierKm) {
  if (!existsSync(route.txt)) {
    console.error(`Missing txt: ${route.txt}`);
    process.exit(1);
  }
  const text = readFileSync(route.txt, "utf8");
  const parsed = parseTxtLines(text);
  // Warn when parsed count is less than non-blank Poste-prefixed lines (dropped lines invisible otherwise)
  const posteLineCount = text.split(/\r?\n/).filter(l => /^\s*poste\s+\d+/i.test(l)).length;
  if (parsed.length < posteLineCount) {
    console.warn(`[warn] ${route.name}: parsed ${parsed.length} posts but found ${posteLineCount} Poste-prefixed lines ` +
      `— ${posteLineCount - parsed.length} line(s) dropped (malformed or non-decimal coordinates?)`);
  }
  const { kept, excluded } = excludeOutliers(parsed, outlierKm);
  writeFileSync(route.out, JSON.stringify(kept, null, 2) + "\n", "utf8");
  console.log(`${route.name}: wrote ${kept.length} posts (excluded ${excluded})`);
  return { kept: kept.length, excluded };
}

const outlierKm = parseOutlierKm(process.argv.slice(2));
if (!Number.isFinite(outlierKm) || outlierKm <= 0) {
  console.error("--outlier-km must be a positive number");
  process.exit(1);
}

for (const route of ROUTES) {
  importRoute(route, outlierKm);
}
