import fs from 'node:fs';
import { buildKml } from './parser/kml-builder.js';
import { packageKmz } from './parser/kmz-packager.js';

const posts = [
  { number: 1, lat: -27.65946, lon: -48.69924 },
  { number: 2, lat: -27.65942, lon: -48.6996 },
];
const connections = [{ from: 1, to: 2 }];
const { kml } = buildKml(posts, connections, {});
const blob = await packageKmz(kml);
const buf = Buffer.from(await blob.arrayBuffer());
fs.writeFileSync('route-smoke.kmz', buf);
console.log('Wrote route-smoke.kmz', buf.length, 'bytes');
