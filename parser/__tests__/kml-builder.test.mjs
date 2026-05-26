import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildKml } from '../kml-builder.js';

describe('buildKml', () => {
  it('builds placemarks and one line for a simple route', () => {
    const posts = [
      { number: 1, lat: -27.65, lon: -48.69 },
      { number: 2, lat: -27.66, lon: -48.7 },
    ];
    const connections = [{ from: 1, to: 2 }];
    const { kml, stats } = buildKml(posts, connections, {});
    assert.equal(stats.placemarkCount, 2);
    assert.equal(stats.lineCount, 1);
    assert.match(kml, /xmlns="http:\/\/www\.opengis\.net\/kml\/2\.2"/);
    assert.match(kml, /Style id="postPoint"/);
    assert.match(kml, /<name>Poste 01<\/name>/);
    assert.match(kml, /<LineString>/);
  });

  it('draws multiple lines from connection graph (branch)', () => {
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
    assert.equal(stats.lineCount, 3);
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
