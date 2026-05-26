import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildKml, buildRoutePolylines } from '../kml-builder.js';

describe('buildRoutePolylines', () => {
  it('merges a simple chain into one polyline', () => {
    const connections = [
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 3, to: 4 },
    ];
    const lines = buildRoutePolylines(connections);
    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0].postNumbers, [1, 2, 3, 4]);
  });

  it('splits at bifurcation into main run and branch', () => {
    const connections = [
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 2, to: 4 },
    ];
    const branchStarts = new Set([4]);
    const lines = buildRoutePolylines(connections, branchStarts);
    assert.equal(lines.length, 2);
    const sorted = lines
      .map((l) => l.postNumbers.join(','))
      .sort()
      .join('|');
    assert.match(sorted, /1,2,3/);
    assert.match(sorted, /2,4/);
  });

  it('splits on gap edges', () => {
    const connections = [
      { from: 1, to: 2 },
      { from: 2, to: 3, gap: true },
      { from: 3, to: 4 },
    ];
    const lines = buildRoutePolylines(connections);
    assert.equal(lines.length, 3);
    assert.deepEqual(
      lines.find((l) => l.gap)?.postNumbers,
      [2, 3],
    );
    assert.deepEqual(
      lines.find((l) => !l.gap && l.postNumbers[0] === 1)?.postNumbers,
      [1, 2],
    );
    assert.deepEqual(
      lines.find((l) => !l.gap && l.postNumbers[0] === 3)?.postNumbers,
      [3, 4],
    );
  });
});

describe('buildKml', () => {
  it('builds placemarks and one merged line for a simple route', () => {
    const posts = [
      { number: 1, lat: -27.65, lon: -48.69 },
      { number: 2, lat: -27.66, lon: -48.7 },
      { number: 3, lat: -27.67, lon: -48.71 },
    ];
    const connections = [
      { from: 1, to: 2 },
      { from: 2, to: 3 },
    ];
    const { kml, stats } = buildKml(posts, connections, {});
    assert.equal(stats.placemarkCount, 3);
    assert.equal(stats.lineCount, 1);
    const lineStrings = kml.match(/<LineString>/g) || [];
    assert.equal(lineStrings.length, 1);
    const routeCoords = kml.match(
      /<LineString>[\s\S]*?<coordinates>([^<]+)<\/coordinates>/,
    )?.[1];
    assert.ok(routeCoords?.trim().split(/\s+/).length >= 3);
    assert.match(kml, /Route 01–03/);
  });

  it('draws two cable runs at a branch (not one line per edge)', () => {
    const posts = [
      { number: 1, lat: 1, lon: 1 },
      { number: 2, lat: 2, lon: 2 },
      { number: 3, lat: 3, lon: 3 },
      { number: 4, lat: 4, lon: 4 },
    ];
    const connections = [
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 2, to: 4 },
    ];
    const { stats } = buildKml(posts, connections, {});
    assert.equal(stats.placemarkCount, 4);
    assert.equal(stats.lineCount, 2);
  });

  it('omits posts without GPS and counts them', () => {
    const posts = [
      { number: 1, lat: 1, lon: 1 },
      { number: 3, lat: null, lon: null },
    ];
    const { kml, stats } = buildKml(posts, [], {});
    assert.equal(stats.omittedNoGps, 1);
    assert.equal(stats.placemarkCount, 1);
    assert.doesNotMatch(kml, /<name>Poste 03<\/name>/);
  });

  it('escapes line description in XML', () => {
    const posts = [
      { number: 1, lat: 1, lon: 1 },
      { number: 2, lat: 2, lon: 2 },
    ];
    const { kml } = buildKml(
      posts,
      [{ from: 1, to: 2 }],
      { lineDescription: 'Cable <A>&B' },
    );
    assert.match(kml, /Cable &lt;A&gt;&amp;B/);
  });

  it('returns valid empty document', () => {
    const { kml, stats } = buildKml([], [], {});
    assert.equal(stats.placemarkCount, 0);
    assert.match(kml, /<Document>/);
    assert.ok(Array.isArray(stats.warnings));
  });
});
