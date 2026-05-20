import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectSequenceFlipPages,
  remapBrowserPostNumber,
  remapBrowserPostsToParserOrder,
} from '../geo/route-sequence.js';

describe('route-sequence', () => {
  it('remaps browser page 3 and 5 post numbers to parser order', () => {
    assert.equal(remapBrowserPostNumber(1, 3), 14);
    assert.equal(remapBrowserPostNumber(14, 3), 1);
    assert.equal(remapBrowserPostNumber(26, 5), 34);
    assert.equal(remapBrowserPostNumber(15, 4), 15);
  });

  it('detects flip when route post 1 is east of post 2 on page 3', () => {
    const sorted = [
      { number: 1, pageNum: 3, x: 1152, y: 160 },
      { number: 2, pageNum: 3, x: 1054, y: 186 },
    ];
    const flip = detectSequenceFlipPages(sorted);
    assert.deepEqual([...flip].sort(), [3, 5]);
  });

  it('does not flip parser-order page 3 (post 1 west of post 2)', () => {
    const sorted = [
      { number: 1, pageNum: 3, x: 269, y: 421 },
      { number: 2, pageNum: 3, x: 352, y: 457 },
    ];
    assert.equal(detectSequenceFlipPages(sorted).size, 0);
  });

  it('remapBrowserPostsToParserOrder sorts by number', () => {
    const out = remapBrowserPostsToParserOrder([
      { number: 14, pageNum: 3, x: 1, y: 2 },
      { number: 1, pageNum: 3, x: 3, y: 4 },
    ]);
    assert.equal(out[0].number, 1);
    assert.equal(out[1].number, 14);
  });
});
