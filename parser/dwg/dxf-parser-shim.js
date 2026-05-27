/** Browser import-map target for `dxf-parser` (UMD bundle loaded via script in index.html). */
const DxfParser = globalThis.DxfParser;
if (!DxfParser) {
  throw new Error(
    "DxfParser global missing — ensure node_modules/dxf-parser/dist/dxf-parser.js is loaded before modules",
  );
}
export default DxfParser;
