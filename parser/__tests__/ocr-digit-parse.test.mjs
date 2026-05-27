/**
 * ocr-digit-parse.test.mjs
 * Run: node parser/__tests__/ocr-digit-parse.test.mjs
 */
import { parseOcrDigitText } from "../ocr-extractor.js";

let pass = 0;
let fail = 0;
function assert(cond, name) {
  if (cond) {
    console.log(`  PASS: ${name}`);
    pass++;
  } else {
    console.error(`  FAIL: ${name}`);
    fail++;
  }
}

assert(parseOcrDigitText("50") === 50, "whole label 50");
assert(parseOcrDigitText(" 058 ") === 58, "longest run 058 → 58");
assert(parseOcrDigitText("noise 93") === 93, "longest run 93");
assert(parseOcrDigitText("") === null, "empty");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
