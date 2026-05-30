// Wrapper: normalize CRLF -> LF before applying edits, restore CRLF after.
import { readFileSync, writeFileSync } from "node:fs";
const path = "parser/dwg/graph-walker.js";
const orig = readFileSync(path, "utf8");
const hadCRLF = orig.includes("\r\n");
writeFileSync(path, orig.replace(/\r\n/g, "\n"), "utf8");
await import("./.apply-branch-return.mjs");
if (hadCRLF) {
  const lf = readFileSync(path, "utf8");
  writeFileSync(path, lf.replace(/\n/g, "\r\n"), "utf8");
  console.log("restored CRLF");
}
