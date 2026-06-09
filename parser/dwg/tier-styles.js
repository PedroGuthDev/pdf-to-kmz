/**
 * Pure, no-I/O helper for per-post confidence tier KML styling (Phase 9, D-01/D-03/D-05).
 *
 * Mirrors the shape of `../kml-color.js`: JSDoc header, named exports, zero side
 * effects, throws on invalid input. Translates the residual-gate tier vocabulary
 * (HIGH/MED/LOW/UNRESOLVABLE) into a traffic-light KML <Style> palette, the
 * camelCase style ids the placemark loop references, and the Portuguese balloon
 * labels (CONF-04: labels only, never a numeric % seal).
 *
 * The four hexes REUSE the kmz-defaults PRESET_COLORS green/yellow/amber/red so
 * the palette stays consistent across the codebase. UNRESOLVABLE is red (alarming),
 * not grey — the locked traffic-light mental model (CONTEXT §specifics).
 */

import { hexToKmlColor } from '../kml-color.js';

/**
 * Tier → `#RRGGBB` traffic-light color (D-01). Values match PRESET_COLORS
 * green/yellow/amber/red in `../kmz-defaults.js`.
 * @type {{ HIGH: string, MED: string, LOW: string, UNRESOLVABLE: string }}
 */
export const TIER_HEX = {
  HIGH: '#00ff00', // green
  MED: '#ffff00', // yellow
  LOW: '#ffaa00', // amber/orange
  UNRESOLVABLE: '#ff0000', // red
};

/**
 * Tier → Portuguese balloon label (D-05). Labels only — no numeric %.
 * @type {{ HIGH: string, MED: string, LOW: string, UNRESOLVABLE: string }}
 */
export const TIER_LABEL_PT = {
  HIGH: 'ALTA',
  MED: 'MÉDIA',
  LOW: 'BAIXA',
  UNRESOLVABLE: 'NÃO RESOLVIDO',
};

/**
 * Tier → camelCase KML style id used by the placemark `<styleUrl>`.
 * @type {{ HIGH: string, MED: string, LOW: string, UNRESOLVABLE: string }}
 */
const TIER_STYLE_ID = {
  HIGH: 'tierHigh',
  MED: 'tierMed',
  LOW: 'tierLow',
  UNRESOLVABLE: 'tierUnresolvable',
};

/**
 * @param {"HIGH"|"MED"|"LOW"|"UNRESOLVABLE"} tier
 * @returns {void}
 */
function assertKnownTier(tier) {
  if (!Object.prototype.hasOwnProperty.call(TIER_HEX, tier)) {
    throw new Error(`unknown tier: ${tier}`);
  }
}

/**
 * Map a tier label to its camelCase KML style id.
 * @param {"HIGH"|"MED"|"LOW"|"UNRESOLVABLE"} tier
 * @returns {string} e.g. "tierHigh"
 */
export function tierStyleId(tier) {
  assertKnownTier(tier);
  return TIER_STYLE_ID[tier];
}

/**
 * Build a single-line `<Style id="tier…">` block for a tier, mirroring the
 * existing `#postPoint` template in kml-builder.js (IconStyle color+scale+Icon
 * href, LabelStyle color+scale) but with the tier color. The IconStyle <color>
 * is `hexToKmlColor(TIER_HEX[tier])`; the <Icon><href> is the passed iconHref.
 *
 * @param {"HIGH"|"MED"|"LOW"|"UNRESOLVABLE"} tier
 * @param {string} iconHref - already-escaped icon href (caller escapes consistently)
 * @param {object} [opts]
 * @param {string} [opts.labelColorKml] - aabbggrr label color (defaults to white)
 * @param {number|string} [opts.labelScale=1] - LabelStyle scale
 * @returns {string} `<Style id="tier…">…</Style>`
 */
export function tierStyleBlock(tier, iconHref, opts = {}) {
  assertKnownTier(tier);
  const iconColorKml = hexToKmlColor(TIER_HEX[tier]);
  const labelColorKml = opts.labelColorKml ?? hexToKmlColor('#ffffff');
  const labelScale = opts.labelScale ?? 1;
  return (
    `<Style id="${tierStyleId(tier)}">` +
    `<IconStyle><color>${iconColorKml}</color><scale>1</scale>` +
    `<Icon><href>${iconHref}</href></Icon></IconStyle>` +
    `<LabelStyle><color>${labelColorKml}</color><scale>${labelScale}</scale></LabelStyle>` +
    `</Style>`
  );
}
