import DxfParser from "dxf-parser";

const CABLE_LAYERS = new Set(["TrechoSecundarioAereo", "TrechoPrimarioAereo"]);
/** Skip storing the raw DXF blob in IndexedDB above this size (Palhoca gate budget). */
const MAX_SOURCE_DXF_STORE_BYTES = 50_000_000;

function emptyResult() {
  return {
    posts: [],
    cableEdges: [],
    primaryCableEdges: [],
    extmin: { x: 0, y: 0 },
    extmax: { x: 0, y: 0 },
  };
}

function readLine(text, state) {
  const len = text.length;
  let start = state.pos;
  while (state.pos < len && text[state.pos] !== "\n" && text[state.pos] !== "\r") {
    state.pos++;
  }
  const line = text.slice(start, state.pos).trim();
  if (text[state.pos] === "\r") state.pos++;
  if (text[state.pos] === "\n") state.pos++;
  return line;
}

function readPair(text, state) {
  const codeLine = readLine(text, state);
  if (!codeLine) return null;
  const code = Number.parseInt(codeLine, 10);
  if (!Number.isFinite(code)) return readPair(text, state);
  const value = readLine(text, state);
  return { code, value };
}

/**
 * Index-based line-pair scanner for large city DXFs. Avoids dxf-parser's full
 * object graph and the memory cost of splitting 134 MB into ~17 M lines.
 */
function parseDxfTextFast(dxfText) {
  const posts = [];
  const cableEdges = [];
  const primaryCableEdges = [];
  const extmin = { x: 0, y: 0 };
  const extmax = { x: 0, y: 0 };

  let section = null;
  let headerVar = null;
  let entityType = null;
  let layer = null;
  let block = null;
  let insertX = null;
  let insertY = null;
  let polyLayer = null;
  let polyId = 0;
  /** @type {Array<{x:number,y:number}>} */
  let polyVerts = [];

  const flushPolyline = () => {
    if (!polyLayer || polyVerts.length < 2) {
      polyVerts = [];
      return;
    }
    const poly = polyId++;
    const isSecondary = polyLayer === "TrechoSecundarioAereo";
    for (let k = 1; k < polyVerts.length; k++) {
      const a = polyVerts[k - 1];
      const b = polyVerts[k];
      const edge = { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, poly };
      if (isSecondary) cableEdges.push(edge);
      else primaryCableEdges.push(edge);
    }
    polyVerts = [];
    polyLayer = null;
  };

  const flushInsert = () => {
    if (entityType !== "INSERT" || layer !== "Poste") return;
    if (typeof insertX === "number" && typeof insertY === "number") {
      posts.push({ x: insertX, y: insertY, block: block ?? "unknown" });
    }
    insertX = null;
    insertY = null;
    block = null;
  };

  const state = { pos: 0 };
  while (state.pos < dxfText.length) {
    const pair = readPair(dxfText, state);
    if (!pair) break;
    const { code, value } = pair;

    if (code === 0) {
      if (value === "SECTION") {
        section = null;
        const namePair = readPair(dxfText, state);
        if (namePair?.code === 2) {
          section = namePair.value;
        }
        if (section !== "HEADER" && section !== "ENTITIES") {
          section = "SKIP";
        }
        if (section === "ENTITIES") {
          entityType = null;
          layer = null;
          block = null;
          insertX = null;
          insertY = null;
          polyLayer = null;
          polyVerts = [];
        }
        continue;
      }

      if (value === "ENDSEC") {
        if (section === "ENTITIES") {
          flushInsert();
          flushPolyline();
        }
        section = null;
        headerVar = null;
        entityType = null;
        continue;
      }

      if (section === "SKIP") continue;

      if (section === "ENTITIES") {
        flushInsert();
        flushPolyline();
        entityType = value;
        layer = null;
        block = null;
        insertX = null;
        insertY = null;
        polyLayer = null;
        polyVerts = [];
      }
      continue;
    }

    if (section === "SKIP") continue;

    if (section === "HEADER") {
      if (code === 9) headerVar = value;
      else if (headerVar === "$EXTMIN" && code === 10) extmin.x = Number.parseFloat(value);
      else if (headerVar === "$EXTMIN" && code === 20) extmin.y = Number.parseFloat(value);
      else if (headerVar === "$EXTMAX" && code === 10) extmax.x = Number.parseFloat(value);
      else if (headerVar === "$EXTMAX" && code === 20) extmax.y = Number.parseFloat(value);
      continue;
    }

    if (section !== "ENTITIES") continue;

    if (code === 8) {
      layer = value;
      if (entityType === "LWPOLYLINE" && CABLE_LAYERS.has(value)) {
        polyLayer = value;
      }
    } else if (entityType === "INSERT" && layer === "Poste") {
      if (code === 2) block = value;
      else if (code === 10) insertX = Number.parseFloat(value);
      else if (code === 20) insertY = Number.parseFloat(value);
    } else if (entityType === "LWPOLYLINE" && polyLayer) {
      if (code === 10) {
        polyVerts.push({ x: Number.parseFloat(value), y: NaN });
      } else if (code === 20 && polyVerts.length > 0) {
        polyVerts[polyVerts.length - 1].y = Number.parseFloat(value);
      }
    }
  }

  flushInsert();
  flushPolyline();

  return { posts, cableEdges, primaryCableEdges, extmin, extmax };
}

function parseDxfTextLegacy(dxfText) {
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

/**
 * Parse DXF text and extract only the entities we need for DWG pairing:
 * - Poste layer INSERTs → regional posts (UTM easting/northing)
 * - TrechoSecundarioAereo layer LWPOLYLINE endpoints → cable edges (topology hint)
 *
 * CRITICAL TRAPS (from 02-RESEARCH.md):
 * - DO NOT scale coordinates based on $INSUNITS. Entity coordinates are raw UTM metres.
 * - DO NOT use $LATITUDE/$LONGITUDE from the DXF header (AutoCAD defaults).
 */
export function parseDxfText(dxfText) {
  if (typeof dxfText !== "string" || dxfText.length === 0) {
    return emptyResult();
  }

  if (dxfText.length >= 1_000_000) {
    return parseDxfTextFast(dxfText);
  }

  return parseDxfTextLegacy(dxfText);
}

export { parseDxfTextFast, parseDxfTextLegacy, MAX_SOURCE_DXF_STORE_BYTES };
