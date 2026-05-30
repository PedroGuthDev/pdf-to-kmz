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
  if (typeof globalThis.navigator === "undefined") {
    try {
      Object.defineProperty(globalThis, "navigator", {
        value: { language: "en-US", platform: "", userAgent: "" },
        configurable: true,
      });
    } catch {
      // navigator is non-configurable on this runtime; skip polyfill
    }
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

/** True when `process.env[name] === "1"` (safe in browser bundles). */
export function envFlag(name) {
  return typeof process !== "undefined" && process.env?.[name] === "1";
}

/** True when `process.env[name]` is set and non-empty (safe in browser bundles). */
export function envTruthy(name) {
  return typeof process !== "undefined" && Boolean(process.env?.[name]);
}

/**
 * Create a canvas in an environment-agnostic (isomorphic) way.
 * Uses OffscreenCanvas in the browser, and @napi-rs/canvas in Node.js.
 *
 * @param {number} w
 * @param {number} h
 * @returns {Promise<OffscreenCanvas | import('@napi-rs/canvas').Canvas>}
 */
export async function createIsomorphicCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(w, h);
  }
  if (isNodeRuntime()) {
    return await createNodeCanvas(w, h);
  }
  throw new Error(
    "No canvas implementation (OffscreenCanvas or @napi-rs/canvas)"
  );
}
