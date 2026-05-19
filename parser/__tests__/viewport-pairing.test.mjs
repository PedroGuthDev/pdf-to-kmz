import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('viewport label filter', () => {
  const numPages = 9;

  function acceptLabel(s) {
    if (!/^\d{2}$/.test(s)) return false;
    const n = parseInt(s, 10);
    return n >= 3 && n <= numPages;
  }

  it('accepts detail page labels 03–09', () => {
    assert.equal(acceptLabel('03'), true);
    assert.equal(acceptLabel('05'), true);
    assert.equal(acceptLabel('09'), true);
  });

  it('rejects distance labels that look like page numbers (34, 37)', () => {
    assert.equal(acceptLabel('34'), false);
    assert.equal(acceptLabel('37'), false);
    assert.equal(acceptLabel('35'), false);
  });
});
