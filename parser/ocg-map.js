// parser/ocg-map.js
// OCG (Optional Content Group) map builder, layer validator, and name normalizer.
// Named ESM exports only — no default export, no CommonJS require.

/**
 * Strip diacritics and lowercase a string for layer name comparison.
 * Uses NFD decomposition so "Distância_Poste" (â U+00E2) becomes "distancia_poste".
 *
 * @param {string} s
 * @returns {string}
 */
export const normalizeName = s =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Display forms used in missing[] error messages (D-08 human-readable).
const REQUIRED_LAYERS_DISPLAY = [
  'Numero_Poste',
  'TEXTO',
  'Distância_Poste',
  'Cabo Projetado',
];

// Pre-normalized forms used for comparison at validateLayers() time.
const REQUIRED_LAYERS_NORMALIZED = REQUIRED_LAYERS_DISPLAY.map(normalizeName);

/**
 * Build a bidirectional map between OCG group IDs and layer names.
 *
 * Uses Symbol.iterator on the OptionalContentConfig — config.getGroups() does
 * NOT exist in pdf.js 5.x. Each iteration yields [id, group] where group.name
 * is the raw (un-normalized) layer name string.
 *
 * @param {import('pdfjs-dist').PDFDocumentProxy} pdfDoc
 * @returns {Promise<{ idToName: Object, nameToId: Object, allNames: string[] }>}
 */
export async function buildOcgMap(pdfDoc) {
  const config = await pdfDoc.getOptionalContentConfig();
  const idToName = {};
  const nameToId = {};
  const allNames = [];

  for (const [id, group] of config) {
    const name = group.name;
    // Dual-key: BDC args sometimes use numeric ids, sometimes string ids — lookup must work.
    idToName[id] = name;
    idToName[String(id)] = name;
    nameToId[name] = id;
    allNames.push(name);
  }

  return { idToName, nameToId, allNames };
}

/**
 * Validate that all four required data layers are present in the PDF.
 *
 * Comparison uses normalizeName on BOTH the candidate name from allNames AND
 * the required layer name so accented characters (Distância_Poste) match
 * their ASCII equivalents after diacritic stripping.
 *
 * @param {string[]} allNames  Raw OCG layer names from buildOcgMap.
 * @returns {{ valid: boolean, missing: string[], allNames: string[] }}
 */
export function validateLayers(allNames) {
  const missing = [];

  for (let i = 0; i < REQUIRED_LAYERS_NORMALIZED.length; i++) {
    const normalizedExpected = REQUIRED_LAYERS_NORMALIZED[i];
    const found = allNames.some(
      name => normalizeName(name) === normalizedExpected
    );
    if (!found) {
      // Push display form so the error message is human-readable.
      missing.push(REQUIRED_LAYERS_DISPLAY[i]);
    }
  }

  return { valid: missing.length === 0, missing, allNames };
}
