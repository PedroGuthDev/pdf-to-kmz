import * as esbuild from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const prod =
  process.env.VERCEL === "1" ||
  process.argv.includes("--prod") ||
  process.env.NODE_ENV === "production";
const watch = process.argv.includes("--watch");

mkdirSync("dist", { recursive: true });

function writeDistHtml() {
  const html = readFileSync("index.html", "utf8");
  writeFileSync("dist/index.html", html.replaceAll("./dist/app.js", "./app.js"));
}

/** Keep heavy PDF/OCR libs on CDN (same as unbundled browser path). */
const browserExternals = [
  "pdfjs-dist",
  "pdfjs-dist/*",
  "tesseract.js",
  "tesseract.js/*",
  "canvas",
  "@napi-rs/canvas",
  "node:fs",
  "node:path",
];

const buildOpts = {
  entryPoints: ["browser/main.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: "dist/app.js",
  minify: prod,
  sourcemap: !prod,
  logLevel: "info",
  external: browserExternals,
};

if (watch) {
  const ctx = await esbuild.context(buildOpts);
  await ctx.watch();
  writeDistHtml();
  console.log("Watching browser/main.js → dist/app.js");
} else {
  await esbuild.build(buildOpts);
  writeDistHtml();
  console.log(`Build complete (${prod ? "production" : "development"}) → dist/`);
}
