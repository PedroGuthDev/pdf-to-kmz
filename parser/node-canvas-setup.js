// parser/node-canvas-setup.js
// pdf.js 5.x on Node expects @napi-rs/canvas and DOMMatrix/ImageData/Path2D polyfills
// before legacy/build/pdf.mjs is evaluated. The older `canvas` (node-canvas) package
// renders blank pages with pdf.js 5 (Path2D / clip incompatibility).

let _polyfillsDone = false;

/**
 * Install @napi-rs/canvas globals required by pdf.js 5 legacy Node build.
 * Idempotent — safe to call multiple times.
 */
export async function ensureNodeCanvasPolyfills() {
  if (_polyfillsDone) return;
  if (typeof process === "undefined" || !process.versions?.node) return;

  const napi = await import("@napi-rs/canvas");
  if (!globalThis.DOMMatrix && napi.DOMMatrix) {
    globalThis.DOMMatrix = napi.DOMMatrix;
  }
  if (!globalThis.ImageData && napi.ImageData) {
    globalThis.ImageData = napi.ImageData;
  }
  if (!globalThis.Path2D && napi.Path2D) {
    globalThis.Path2D = napi.Path2D;
  }
  if (!globalThis.navigator?.language) {
    globalThis.navigator = {
      language: "en-US",
      platform: "",
      userAgent: "",
    };
  }
  _polyfillsDone = true;
}

/**
 * @param {number} w
 * @param {number} h
 * @returns {import('@napi-rs/canvas').Canvas}
 */
export async function createNodeCanvas(w, h) {
  await ensureNodeCanvasPolyfills();
  const { createCanvas } = await import("@napi-rs/canvas");
  return createCanvas(w, h);
}

export function isNodeRuntime() {
  return typeof process !== "undefined" && !!process.versions?.node;
}
