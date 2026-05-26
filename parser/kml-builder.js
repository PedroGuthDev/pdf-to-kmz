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
 * @param {Array<{ number: number, lat?: number|null, lon?: number|null }>} posts
 * @param {Array<{ from: number, to: number }>} connections
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

  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '<Document>',
    '<name>pdf-to-kmz route</name>',
    `<Style id="postPoint"><IconStyle><color>${colors.iconColorKml}</color><scale>1</scale><Icon><href>${escapeXml(merged.iconHref)}</href></Icon></IconStyle><LabelStyle><color>${colors.labelColorKml}</color><scale>${merged.labelScale}</scale></LabelStyle></Style>`,
    `<Style id="routeLine"><LineStyle><color>${colors.lineColorKml}</color><width>${merged.lineWidth}</width></LineStyle></Style>`,
  ];

  for (const post of posts) {
    if (post.lat == null || post.lon == null) {
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

  for (const edge of connections) {
    const fromPost = postByNum.get(edge.from);
    const toPost = postByNum.get(edge.to);
    const fromLabel = padPostNumber(edge.from);
    const toLabel = padPostNumber(edge.to);
    if (
      !fromPost ||
      !toPost ||
      fromPost.lat == null ||
      fromPost.lon == null ||
      toPost.lat == null ||
      toPost.lon == null
    ) {
      stats.skippedLines += 1;
      warnings.push(
        `[kml-builder] edge ${fromLabel}→${toLabel} skipped (missing GPS)`,
      );
      continue;
    }
    const lineName = `Poste ${fromLabel} → Poste ${toLabel}`;
    const lineDesc = escapeXml(merged.lineDescription);
    parts.push(
      '<Placemark>',
      `<name>${escapeXml(lineName)}</name>`,
      `<description>${lineDesc}</description>`,
      '<styleUrl>#routeLine</styleUrl>',
      '<LineString>',
      '<tessellate>1</tessellate>',
      `<coordinates>${fromPost.lon},${fromPost.lat},0 ${toPost.lon},${toPost.lat},0</coordinates>`,
      '</LineString>',
      '</Placemark>',
    );
    stats.lineCount += 1;
  }

  parts.push('</Document>', '</kml>');
  return { kml: parts.join(''), stats };
}
