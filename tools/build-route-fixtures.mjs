/**
 * Generic route-fixture builder: convert a ground-truth txt -> JSON and
 * region-extract the route from Palhoca.dxf -> DWG region JSON, for one or more
 * routes. Loads the 134 MB DXF once for all routes.
 *
 * Requires locally (gitignored): Palhoca.dxf
 * Run: node tools/build-route-fixtures.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseDxfText } from "../parser/dwg/dxf-loader.js";
import { latLonToUtm } from "../parser/geo/utm-calibrator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FIXTURES = path.join(ROOT, "parser", "__tests__", "fixtures");
const DXF = path.join(ROOT, "Palhoca.dxf");
const MARGIN_M = 50;

const ROUTES = [
  {
    id: "joaoborn",
    gtTxt: "coordenadas postes rua joao born.txt",
    re: /poste\s+(\d+);\s*(-?\d+\.\d+),\s*(-?\d+\.\d+)/i,
  },
  {
    id: "valmor",
    gtTxt: "coordenadas postes rua valmor.txt",
    re: /poste\s+(\d+);\s*(-?\d+\.\d+),\s*(-?\d+\.\d+)/i,
  },
];

function parseGt(txtPath, re) {
  const raw = readFileSync(txtPath, "utf8");
  const gt = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(re);
    if (m) {
      gt.push({
        number: parseInt(m[1], 10),
        lat: parseFloat(m[2]),
        lon: parseFloat(m[3]),
      });
    }
  }
  gt.sort((a, b) => a.number - b.number);
  return gt;
}

console.log("Loading Palhoca.dxf (134 MB)…");
const { posts: allPosts, cableEdges: allEdges } = parseDxfText(
  readFileSync(DXF, "latin1"),
);
console.log(`Loaded ${allPosts.length} Poste INSERTs, ${allEdges?.length ?? 0} edges.`);

for (const route of ROUTES) {
  const gtTxt = path.join(ROOT, route.gtTxt);
  if (!existsSync(gtTxt)) {
    console.error(`[${route.id}] missing GT txt: ${gtTxt} — skipping`);
    continue;
  }
  const gt = parseGt(gtTxt, route.re);
  const gtJson = path.join(FIXTURES, `${route.id}-ground-truth.json`);
  writeFileSync(gtJson, JSON.stringify(gt, null, 2) + "\n", "utf8");
  console.log(`[${route.id}] ${gt.length} GT posts -> ${path.basename(gtJson)}`);

  // Reject GT outliers from the bbox computation: a single route spans a few
  // hundred metres, so any GT point far from the cluster median (e.g. a typo in
  // the source txt) would balloon the crop. Median-distance filter (kept out of
  // bbox only; outliers stay in the GT json so accuracy still flags them).
  const allUtm = gt.map((g) => latLonToUtm(g.lat, g.lon));
  const medE = [...allUtm.map((u) => u.easting)].sort((a, b) => a - b)[
    Math.floor(allUtm.length / 2)
  ];
  const medN = [...allUtm.map((u) => u.northing)].sort((a, b) => a - b)[
    Math.floor(allUtm.length / 2)
  ];
  const CLUSTER_RADIUS_M = 3000;
  const gtUtm = allUtm.filter(
    (u) => Math.hypot(u.easting - medE, u.northing - medN) <= CLUSTER_RADIUS_M,
  );
  const dropped = allUtm.length - gtUtm.length;
  if (dropped > 0) {
    console.log(`[${route.id}] dropped ${dropped} GT outlier(s) >${CLUSTER_RADIUS_M} m from cluster for bbox`);
  }
  const minX = Math.min(...gtUtm.map((u) => u.easting)) - MARGIN_M;
  const maxX = Math.max(...gtUtm.map((u) => u.easting)) + MARGIN_M;
  const minY = Math.min(...gtUtm.map((u) => u.northing)) - MARGIN_M;
  const maxY = Math.max(...gtUtm.map((u) => u.northing)) + MARGIN_M;

  const regionPosts = allPosts.filter(
    (p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY,
  );
  const regionEdges = (allEdges ?? []).filter((e) => {
    const ax = e.a?.x, ay = e.a?.y, bx = e.b?.x, by = e.b?.y;
    if (ax == null || ay == null || bx == null || by == null) return false;
    return ax >= minX && ax <= maxX && ay >= minY && ay <= maxY &&
           bx >= minX && bx <= maxX && by >= minY && by <= maxY;
  });
  console.log(
    `[${route.id}] crop bbox x[${minX.toFixed(0)}..${maxX.toFixed(0)}] y[${minY.toFixed(0)}..${maxY.toFixed(0)}] -> ${regionPosts.length} posts, ${regionEdges.length} edges`,
  );
  const regionJson = path.join(FIXTURES, `${route.id}-dwg-region.json`);
  writeFileSync(
    regionJson,
    JSON.stringify({ posts: regionPosts, cableEdges: regionEdges }, null, 2) + "\n",
    "utf8",
  );
  console.log(`[${route.id}] -> ${path.basename(regionJson)}`);
}
console.log("Done.");
