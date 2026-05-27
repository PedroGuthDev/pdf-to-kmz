import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import DxfParser from "dxf-parser";
import { fileURLToPath } from "node:url";

import { latLonToUtm } from "../parser/geo/utm-calibrator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const FIXTURES_DIR = path.join(ROOT, "parser", "__tests__", "fixtures");
const GT_PATH = path.join(ROOT, "coordenadas postes siriu.txt");
const DXF_PATH = path.join(ROOT, "siriu.dxf");

function parseGroundTruth(text) {
  const gt = [];
  const re = /Poste\s+(\d+);\s*([-\d.]+)\s*,\s*([-\d.]+)/g;
  for (const m of text.matchAll(re)) {
    gt.push({ number: Number.parseInt(m[1], 10), lat: Number(m[2]), lon: Number(m[3]) });
  }
  gt.sort((a, b) => a.number - b.number);
  return gt;
}

function bboxFromUtmPoints(points, padM) {
  let minE = Infinity,
    maxE = -Infinity,
    minN = Infinity,
    maxN = -Infinity;
  for (const p of points) {
    minE = Math.min(minE, p.e);
    maxE = Math.max(maxE, p.e);
    minN = Math.min(minN, p.n);
    maxN = Math.max(maxN, p.n);
  }
  return { minE: minE - padM, maxE: maxE + padM, minN: minN - padM, maxN: maxN + padM };
}

function inBbox(x, y, bbox) {
  return x >= bbox.minE && x <= bbox.maxE && y >= bbox.minN && y <= bbox.maxN;
}

function main() {
  const gtText = readFileSync(GT_PATH, "utf8");
  const gt = parseGroundTruth(gtText);
  if (gt.length !== 85) {
    throw new Error(`Expected 85 ground-truth posts, got ${gt.length}`);
  }

  const gtOutPath = path.join(FIXTURES_DIR, "siriu-ground-truth.json");
  writeFileSync(gtOutPath, JSON.stringify(gt, null, 2) + "\n", "utf8");

  const first30 = gt.slice(0, 30);
  const utm30 = first30.map((g) => {
    const { easting, northing, zone } = latLonToUtm(g.lat, g.lon);
    return { e: easting, n: northing, zone };
  });

  const zones = new Set(utm30.map((p) => p.zone));
  if (zones.size !== 1) {
    throw new Error(`Unexpected multi-zone ground truth for first 30 posts: ${[...zones].join(", ")}`);
  }

  const bboxPosts = bboxFromUtmPoints(utm30, 200);
  const bboxEdges = { ...bboxPosts, minE: bboxPosts.minE - 50, maxE: bboxPosts.maxE + 50, minN: bboxPosts.minN - 50, maxN: bboxPosts.maxN + 50 };

  const dxfText = readFileSync(DXF_PATH, "utf8");
  const dxf = new DxfParser().parseSync(dxfText);
  const entities = Array.isArray(dxf?.entities) ? dxf.entities : [];

  const posts = [];
  const cableEdges = [];

  for (const entity of entities) {
    if (entity?.type === "INSERT" && entity?.layer === "Poste") {
      const x = entity?.position?.x;
      const y = entity?.position?.y;
      if (typeof x === "number" && typeof y === "number" && inBbox(x, y, bboxPosts)) {
        posts.push({ x, y, block: entity?.name ?? "unknown" });
      }
    }

    if (entity?.type === "LWPOLYLINE" && entity?.layer === "TrechoSecundarioAereo") {
      const vertices = entity?.vertices;
      if (Array.isArray(vertices) && vertices.length >= 2) {
        const a = vertices[0];
        const b = vertices[vertices.length - 1];
        if (
          a &&
          b &&
          typeof a.x === "number" &&
          typeof a.y === "number" &&
          typeof b.x === "number" &&
          typeof b.y === "number" &&
          inBbox(a.x, a.y, bboxEdges) &&
          inBbox(b.x, b.y, bboxEdges)
        ) {
          cableEdges.push({ a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } });
        }
      }
    }
  }

  const subsetOutPath = path.join(FIXTURES_DIR, "siriu-subset.json");
  writeFileSync(subsetOutPath, JSON.stringify({ posts, cableEdges }, null, 2) + "\n", "utf8");

  console.log(`Ground truth: ${gt.length} posts.`);
  console.log(`Subset: ${posts.length} posts, ${cableEdges.length} cable edges within bbox of posts 1-30.`);
}

main();
