import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hexToKmlColor } from '../kml-color.js';

describe('hexToKmlColor', () => {
  it('converts red with default opaque alpha', () => {
    assert.equal(hexToKmlColor('#ff0000'), 'ff0000ff');
  });

  it('converts blue (KML byte order)', () => {
    assert.equal(hexToKmlColor('#0000ff'), 'ffff0000');
  });

  it('converts green without hash prefix', () => {
    assert.equal(hexToKmlColor('00ff00'), 'ff00ff00');
  });

  it('applies custom alpha prefix', () => {
    assert.equal(hexToKmlColor('#00ff00', 128).slice(0, 2), '80');
  });

  it('throws on invalid hex', () => {
    assert.throws(() => hexToKmlColor('not-a-color'), /invalid hex/i);
  });
});
