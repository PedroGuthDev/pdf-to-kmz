import DxfParser from "dxf-parser";

/**
 * Parse DXF text and extract only the entities we need for DWG pairing:
 * - Poste layer INSERTs → regional posts (UTM easting/northing)
 * - TrechoSecundarioAereo layer LWPOLYLINE endpoints → cable edges (topology hint)
 *
 * CRITICAL TRAPS (from 02-RESEARCH.md):
 * - DO NOT scale coordinates based on $INSUNITS. In `siriu.dxf`, entity coordinates are raw UTM meters
 *   (x ~ 730000, y ~ 6900000). Scaling by 1/1000 would be catastrophically wrong.
 * - DO NOT use $LATITUDE/$LONGITUDE from the DXF header. In `siriu.dxf` they are AutoCAD defaults
 *   (San Francisco), not a real georeference. Treat entity x/y as UTM easting/northing.
 */
export function parseDxfText(dxfText) {
  if (typeof dxfText !== "string" || dxfText.length === 0) {
    return {
      posts: [],
      cableEdges: [],
      primaryCableEdges: [],
      extmin: { x: 0, y: 0 },
      extmax: { x: 0, y: 0 },
    };
  }

  const dxf = new DxfParser().parseSync(dxfText);
  const extmin = {
    x: dxf?.header?.$EXTMIN?.x ?? 0,
    y: dxf?.header?.$EXTMIN?.y ?? 0,
  };
  const extmax = {
    x: dxf?.header?.$EXTMAX?.x ?? 0,
    y: dxf?.header?.$EXTMAX?.y ?? 0,
  };

  const entities = Array.isArray(dxf?.entities) ? dxf.entities : [];
  const posts = [];
  /** Aerial cable layers used for route topology. Secondary feeds the walker; both
   *  feed cable-topology derivation. */
  const CABLE_LAYERS = new Set(["TrechoSecundarioAereo", "TrechoPrimarioAereo"]);
  const primaryCableEdges = [];
  let polyId = 0;
  const cableEdges = [];

  for (const entity of entities) {
    if (entity?.type === "INSERT" && entity?.layer === "Poste") {
      const x = entity?.position?.x;
      const y = entity?.position?.y;
      if (typeof x === "number" && typeof y === "number") {
        posts.push({ x, y, block: entity?.name ?? "unknown" });
      }
      continue;
    }

    if (entity?.type === "LWPOLYLINE" && CABLE_LAYERS.has(entity?.layer)) {
      const vertices = entity?.vertices;
      if (Array.isArray(vertices) && vertices.length >= 2) {
        // Emit one edge per consecutive vertex pair so intermediate posts on
        // polyline bends are connected to their neighbours in the adjacency graph.
        // Tag each edge with its source polyline index (`poly`) so topology
        // derivation can distinguish a single cable span from two distinct cables
        // that merely cross/near-touch in dense areas. Secondary edges feed the
        // graph-walker adjacency (unchanged); the primary layer completes the route
        // where it switches feeders, so cable-topology derivation sees one network.
        const poly = polyId++;
        const isSecondary = entity.layer === "TrechoSecundarioAereo";
        for (let k = 1; k < vertices.length; k++) {
          const a = vertices[k - 1];
          const b = vertices[k];
          if (
            a &&
            b &&
            typeof a.x === "number" &&
            typeof a.y === "number" &&
            typeof b.x === "number" &&
            typeof b.y === "number"
          ) {
            const edge = { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, poly };
            if (isSecondary) cableEdges.push(edge);
            else primaryCableEdges.push(edge);
          }
        }
      }
    }
  }

  return { posts, cableEdges, primaryCableEdges, extmin, extmax };
}

