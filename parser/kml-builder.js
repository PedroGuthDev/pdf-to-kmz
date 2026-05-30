import { mergeOptions, resolveStyleColors } from './kmz-defaults.js';

/**
 * @param {string} str
 * @returns {string}
 */
function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * @param {number} n
 * @returns {string}
 */
function padPostNumber(n) {
  return String(n).padStart(2, '0');
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
  const consecutive = sorted.find((e) => e.to === from + 1);
  const jumps = sorted.filter((e) => e.to !== from + 1);

  if (jumps.length > 0 && consecutive) {
    for (const jump of jumps) {
      const hi = jump.to;
      const mainCont = (outMap.get(hi) ?? []).find(
        (e) =>
          e.to === hi + 1 && !used.has(`${e.from}->${e.to}`),
      );
      if (mainCont) return jump;
    }
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

  for (const e of chainEdges) {
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

  const branchStarts = new Set();
  for (const e of connections) {
    if (e.gap === true) continue;
    const outs = connections.filter(
      (c) => c.from === e.from && c.gap !== true && c.to !== e.to,
    );
    if (outs.length > 0) {
      for (const o of outs) {
        if (Math.abs(o.to - e.from) > 1) {
          branchStarts.add(o.to);
        }
      }
    }
  }

  const drawableConnections = [];
  for (const edge of connections) {
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
    '<Document>',
    '<name>pdf-to-kmz route</name>',
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
      '<Placemark>',
      `<name>${escapeXml(name)}</name>`,
      `<description>${escapeXml(desc)}</description>`,
      '<styleUrl>#postPoint</styleUrl>',
      '<Point>',
      '<altitudeMode>clampToGround</altitudeMode>',
      `<coordinates>${post.lon},${post.lat},0</coordinates>`,
      '</Point>',
      '</Placemark>',
    );
    stats.placemarkCount += 1;
  }

  const polylines = buildRoutePolylines(drawableConnections, branchStarts);
  const lineDesc = escapeXml(merged.lineDescription);

  for (const { postNumbers, gap } of polylines) {
    const coords = [];
    for (const num of postNumbers) {
      const p = postByNum.get(num);
      if (!hasGps(p)) continue;
      coords.push(`${p.lon},${p.lat},0`);
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
      '<Placemark>',
      `<name>${escapeXml(lineName)}</name>`,
      `<description>${lineDesc}</description>`,
      '<styleUrl>#routeLine</styleUrl>',
      '<LineString>',
      '<tessellate>1</tessellate>',
      `<coordinates>${coords.join(' ')}</coordinates>`,
      '</LineString>',
      '</Placemark>',
    );
    stats.lineCount += 1;
    if (gap) {
      warnings.push(
        `[kml-builder] gap segment ${first}→${last} (separate cable run)`,
      );
    }
  }

  parts.push('</Document>', '</kml>');
  return { kml: parts.join(''), stats };
}
