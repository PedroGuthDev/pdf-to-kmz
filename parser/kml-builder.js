import { mergeOptions, resolveStyleColors } from "./kmz-defaults.js";

/**
 * @param {string} str
 * @returns {string}
 */
function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * @param {number} n
 * @returns {string}
 */
function padPostNumber(n) {
  return String(n).padStart(2, "0");
}

/**
 * @param {{ number: number, lat?: number|null, lon?: number|null }|undefined} post
 * @returns {boolean}
 */
function hasGps(post) {
  return post != null && post.lat != null && post.lon != null;
}

/**
 * @param {number} from
 * @param {number} to
 * @returns {string}
 */
function edgeKey(from, to) {
  return `${from}->${to}`;
}

/**
 * A source-tagged trunk edge: the coordinate calculator marks the true through-route
 * at a bifurcation as `bifurcation-main` / `inferred-label`. These are authoritative
 * and must never be dropped or re-routed by render-boundary normalization.
 *
 * @param {{ source?: string }} e
 * @returns {boolean}
 */
function isMainSource(e) {
  return e.source === "bifurcation-main" || e.source === "inferred-label";
}

/**
 * Render-boundary normalization for the DWG geometry path. With real GPS the
 * finalized connections carry spurious edges that split tap chains or draw 2-point
 * noise. Drop them before chaining; never touch source-tagged trunk edges.
 *
 *  - Transitive chord: a non-sourced jump `J→K` (K>J+1) whose target is already
 *    reachable from `J` via OTHER non-gap edges (e.g. `14→16` alongside `14→15→16`).
 *  - Redundant gap-bridge: a `gap` edge that skips >1 post while both endpoints are
 *    already on the trunk (e.g. `51→54` over `51-52-53` / `54-55-56`).
 *
 * @param {Array<{ from: number, to: number, gap?: boolean, source?: string }>} connections
 * @returns {Array<{ from: number, to: number, gap?: boolean, source?: string }>}
 */
function normalizeConnections(connections) {
  const nonGap = connections.filter(
    (c) => c.from != null && c.to != null && c.gap !== true,
  );
  const onTrunk = new Set();
  for (const e of nonGap) {
    onTrunk.add(e.from);
    onTrunk.add(e.to);
  }

  // Undirected adjacency over non-gap edges, keyed for single-edge exclusion.
  const adj = new Map();
  const link = (a, b, key) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: b, key });
  };
  for (const e of nonGap) {
    const key = edgeKey(e.from, e.to);
    link(e.from, e.to, key);
    link(e.to, e.from, key);
  }

  /**
   * @param {number} from
   * @param {number} to
   * @param {string} skipKey
   * @returns {boolean}
   */
  function reachableWithout(from, to, skipKey) {
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length) {
      const cur = stack.pop();
      if (cur === to) return true;
      for (const { to: nxt, key } of adj.get(cur) ?? []) {
        if (key === skipKey || seen.has(nxt)) continue;
        seen.add(nxt);
        stack.push(nxt);
      }
    }
    return false;
  }

  return connections.filter((e) => {
    if (e.from == null || e.to == null) return true;
    if (e.gap === true) {
      if (
        Math.abs(e.to - e.from) > 1 &&
        onTrunk.has(e.from) &&
        onTrunk.has(e.to)
      ) {
        return false;
      }
      return true;
    }
    if (!isMainSource(e) && e.to > e.from + 1) {
      if (reachableWithout(e.from, e.to, edgeKey(e.from, e.to))) return false;
    }
    return true;
  });
}

/**
 * At a bifurcation, follow the main route. When both a consecutive tap leg and a
 * longer rejoin jump exist (branch return), prefer the jump when it continues
 * sequentially (e.g. 5→10→11). Otherwise prefer consecutive main or non-branch spur.
 *
 * @param {number} from
 * @param {Array<{ from: number, to: number }>} candidates
 * @param {Set<number>} branchStarts
 * @param {Map<number, Array<{ from: number, to: number }>>} outMap
 * @param {Set<string>} used
 * @returns {{ from: number, to: number }}
 */
function preferMainRouteEdge(from, candidates, branchStarts, outMap, used) {
  const sorted = [...candidates].sort((a, b) => a.to - b.to);

  // Part A (primary): a source-tagged main edge is authoritative. coordinate-calculator
  // marks the true through-route at a bifurcation as `bifurcation-main` / `inferred-label`.
  const mainTagged = sorted.find(
    (e) => e.source === "bifurcation-main" || e.source === "inferred-label",
  );
  if (mainTagged) return mainTagged;

  const consecutive = sorted.find((e) => e.to === from + 1);
  const jumps = sorted.filter((e) => e.to !== from + 1);

  if (jumps.length > 0 && consecutive) {
    for (const jump of jumps) {
      const hi = jump.to;
      const mainCont = (outMap.get(hi) ?? []).find(
        (e) => e.to === hi + 1 && !used.has(`${e.from}->${e.to}`),
      );
      if (mainCont) return jump;
    }
    // Part B (fallback for source-less inputs): no jump has a hi→hi+1 continuation.
    // A non-continuing jump whose target itself has outgoing edges is a bifurcation
    // rejoin (its next edge is jumpback-suppressed, not absent), so prefer it as main
    // over the consecutive tap. A jump to a bare leaf (no outgoing edges) is a genuine
    // spur and must NOT override the consecutive through-route.
    const continuingJump = jumps.find(
      (jump) => (outMap.get(jump.to) ?? []).length > 0,
    );
    if (continuingJump) return continuingJump;
  }

  if (consecutive) return consecutive;
  const nonBranch = sorted.filter((e) => !branchStarts.has(e.to));
  return nonBranch[0] ?? sorted[0];
}

/**
 * Chain directed edges into polylines; split on gaps and bifurcations.
 *
 * @param {Array<{ from: number, to: number, gap?: boolean }>} connections
 * @param {Set<number>} branchStarts
 * @returns {Array<{ postNumbers: number[], gap: boolean }>}
 */
export function buildRoutePolylines(connections, branchStarts = new Set()) {
  const drawable = connections.filter((e) => e.from != null && e.to != null);
  const gapEdges = drawable.filter((e) => e.gap === true);
  const chainEdges = drawable.filter((e) => e.gap !== true);

  const outMap = new Map();
  for (const e of chainEdges) {
    if (!outMap.has(e.from)) outMap.set(e.from, []);
    outMap.get(e.from).push(e);
  }

  const used = new Set();
  const polylines = [];

  /**
   * @param {number} from
   * @param {number} to
   * @returns {number[]}
   */
  function extendForward(from, to) {
    const path = [from, to];
    used.add(edgeKey(from, to));
    let curr = to;
    while (true) {
      const outs = (outMap.get(curr) || []).filter(
        (e) => !used.has(edgeKey(e.from, e.to)),
      );
      if (outs.length === 0) break;
      const next =
        outs.length === 1
          ? outs[0]
          : preferMainRouteEdge(curr, outs, branchStarts, outMap, used);
      used.add(edgeKey(next.from, next.to));
      path.push(next.to);
      curr = next.to;
    }
    return path;
  }

  // Seed chains from heads (lowest `from` first) so the trunk is consumed from its
  // start and spurs attach to their junction instead of detaching by array order
  // (e.g. `5-6-7-8-9` as one line rather than `5-6` + orphaned `6-7-8-9`).
  const seedOrder = [...chainEdges].sort((a, b) => a.from - b.from || a.to - b.to);
  for (const e of seedOrder) {
    const key = edgeKey(e.from, e.to);
    if (used.has(key)) continue;
    polylines.push({ postNumbers: extendForward(e.from, e.to), gap: false });
  }

  for (const e of gapEdges) {
    polylines.push({ postNumbers: [e.from, e.to], gap: true });
  }

  return polylines;
}

/**
 * @param {Array<{ number: number, lat?: number|null, lon?: number|null }>} posts
 * @param {Array<{ from: number, to: number, gap?: boolean }>} connections
 * @param {Record<string, unknown>} [options]
 * @returns {{ kml: string, stats: { placemarkCount: number, lineCount: number, omittedNoGps: number, skippedLines: number, warnings: string[] } }}
 */
export function buildKml(posts, connections, options = {}) {
  const merged = mergeOptions(options);
  const colors = resolveStyleColors(merged);
  const postByNum = new Map(posts.map((p) => [p.number, p]));
  const warnings = [];
  const stats = {
    placemarkCount: 0,
    lineCount: 0,
    omittedNoGps: 0,
    skippedLines: 0,
    warnings,
  };

  // Render-boundary normalization: drop spurious chords / gap-bridges the DWG
  // geometry path emits (see normalizeConnections). All downstream rendering —
  // branchStarts, drawable edges, polylines — works from the normalized set.
  const normConnections = normalizeConnections(connections);

  const branchStarts = new Set();
  for (const e of normConnections) {
    if (e.gap === true) continue;
    const siblings = normConnections.filter(
      (c) => c.from === e.from && c.gap !== true && c.to !== e.to,
    );
    if (siblings.length === 0) continue;

    const allOut = [e, ...siblings];
    // The main trunk continuation is a source-tagged edge (bifurcation-main /
    // inferred-label) when present; otherwise the consecutive from+1 edge.
    const taggedMain = allOut.find(
      (c) => c.source === "bifurcation-main" || c.source === "inferred-label",
    );

    if (taggedMain) {
      // Flag every OTHER out-edge target (the taps/spurs) as a branch start so it
      // begins its own polyline; never flag the tagged main trunk continuation.
      for (const c of allOut) {
        if (c.to !== taggedMain.to) branchStarts.add(c.to);
      }
    } else {
      // Source-less bifurcation: the consecutive from+1 edge is the tap spur; flag
      // it. Preserve legacy behavior for plain non-consecutive spurs (jump target
      // with |to-from| > 1 and no source) so the already-working junctions are
      // unchanged.
      for (const o of siblings) {
        if (o.to === e.from + 1 || Math.abs(o.to - e.from) > 1) {
          branchStarts.add(o.to);
        }
      }
    }
  }

  const drawableConnections = [];
  for (const edge of normConnections) {
    const fromPost = postByNum.get(edge.from);
    const toPost = postByNum.get(edge.to);
    if (!hasGps(fromPost) || !hasGps(toPost)) {
      stats.skippedLines += 1;
      warnings.push(
        `[kml-builder] edge ${padPostNumber(edge.from)}→${padPostNumber(edge.to)} skipped (missing GPS)`,
      );
      continue;
    }
    drawableConnections.push(edge);
  }

  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    "<Document>",
    "<name>pdf-to-kmz route</name>",
    `<Style id="postPoint"><IconStyle><color>${colors.iconColorKml}</color><scale>1</scale><Icon><href>${escapeXml(merged.iconHref)}</href></Icon></IconStyle><LabelStyle><color>${colors.labelColorKml}</color><scale>${merged.labelScale}</scale></LabelStyle></Style>`,
    `<Style id="routeLine"><LineStyle><color>${colors.lineColorKml}</color><width>${merged.lineWidth}</width></LineStyle></Style>`,
  ];

  for (const post of posts) {
    if (!hasGps(post)) {
      stats.omittedNoGps += 1;
      warnings.push(
        `[kml-builder] post ${padPostNumber(post.number)} omitted (no GPS)`,
      );
      continue;
    }
    const name = `Poste ${padPostNumber(post.number)}`;
    const desc = `Lat: ${post.lat}, Lon: ${post.lon}`;
    parts.push(
      "<Placemark>",
      `<name>${escapeXml(name)}</name>`,
      `<description>${escapeXml(desc)}</description>`,
      "<styleUrl>#postPoint</styleUrl>",
      "<Point>",
      "<altitudeMode>clampToGround</altitudeMode>",
      `<coordinates>${Number(post.lon).toFixed(7)},${Number(post.lat).toFixed(7)},0</coordinates>`,
      "</Point>",
      "</Placemark>",
    );
    stats.placemarkCount += 1;
  }

  // Genuine single-post taps (e.g. 11→12) render as their own short line — every
  // post belongs on the cable path. Spurious 2-point lines (transitive chords,
  // gap-bridges) are already dropped upstream by normalizeConnections.
  const polylines = buildRoutePolylines(drawableConnections, branchStarts);

  const lineDesc = escapeXml(merged.lineDescription);

  for (const { postNumbers, gap } of polylines) {
    const coords = [];
    for (const num of postNumbers) {
      const p = postByNum.get(num);
      if (!hasGps(p)) continue;
      coords.push(`${Number(p.lon).toFixed(7)},${Number(p.lat).toFixed(7)},0`);
    }
    if (coords.length < 2) {
      stats.skippedLines += 1;
      continue;
    }

    const first = padPostNumber(postNumbers[0]);
    const last = padPostNumber(postNumbers[postNumbers.length - 1]);
    const lineName =
      postNumbers.length === 2
        ? `Poste ${first} → Poste ${last}`
        : `Route ${first}–${last}`;

    parts.push(
      "<Placemark>",
      `<name>${escapeXml(lineName)}</name>`,
      `<description>${lineDesc}</description>`,
      "<styleUrl>#routeLine</styleUrl>",
      "<LineString>",
      "<tessellate>1</tessellate>",
      `<coordinates>${coords.join(" ")}</coordinates>`,
      "</LineString>",
      "</Placemark>",
    );
    stats.lineCount += 1;
    if (gap) {
      warnings.push(
        `[kml-builder] gap segment ${first}→${last} (separate cable run)`,
      );
    }
  }

  parts.push("</Document>", "</kml>");
  return { kml: parts.join(""), stats };
}
