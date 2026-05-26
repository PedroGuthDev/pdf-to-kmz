import { hexToKmlColor } from './kml-color.js';

/** Google Earth built-in square icon (D-IC-02). */
export const DEFAULT_OPTIONS = {
  iconHref:
    'http://maps.google.com/mapfiles/kml/shapes/placemark_square.png',
  iconColor: 'green',
  lineColor: 'red',
  lineWidth: 3,
  labelColor: 'white',
  labelScale: 1,
  lineDescription: '',
};

export const PRESET_COLORS = {
  red: '#ff0000',
  green: '#00ff00',
  blue: '#0000ff',
  white: '#ffffff',
  yellow: '#ffff00',
  black: '#000000',
  amber: '#ffaa00',
  aqua: '#55ffff',
  moss: '#55aa00',
};

const PRESET_FALLBACKS = {
  iconColor: 'green',
  lineColor: 'red',
  labelColor: 'white',
};

/**
 * @param {Record<string, unknown>} [user]
 * @returns {typeof DEFAULT_OPTIONS & Record<string, unknown>}
 */
export function mergeOptions(user = {}) {
  return { ...DEFAULT_OPTIONS, ...user };
}

/**
 * @param {ReturnType<typeof mergeOptions>} merged
 * @returns {{ iconColorKml: string, lineColorKml: string, labelColorKml: string }}
 */
export function resolveStyleColors(merged) {
  const toKml = (presetKey, fallbackKey) => {
    const key = String(merged[presetKey] ?? PRESET_FALLBACKS[fallbackKey]);
    const hex = PRESET_COLORS[key] ?? PRESET_COLORS[PRESET_FALLBACKS[fallbackKey]];
    return hexToKmlColor(hex);
  };
  return {
    iconColorKml: toKml('iconColor', 'iconColor'),
    lineColorKml: toKml('lineColor', 'lineColor'),
    labelColorKml: toKml('labelColor', 'labelColor'),
  };
}
