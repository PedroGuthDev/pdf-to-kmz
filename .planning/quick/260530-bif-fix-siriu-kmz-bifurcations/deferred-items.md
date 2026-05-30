# Deferred / Out-of-Scope Items — 260530-bif

## Pre-existing failures in post-positioning.test.mjs (NOT caused by this task)

`node --test parser/__tests__/*.test.mjs` reports 3 failing assertions in
`parser/__tests__/post-positioning.test.mjs`:

- `FAIL: post 4 kept when raw symbol matches circle`
- `FAIL: [D-N2-01 baseline] greedy assignment Valmor p4 max symbol-distance < 30 pt`
- `FAIL: [D-N2-01 fix] Viterbi assignment Valmor p4 max symbol-distance < 5 pt`

### Why these are out of scope

- `post-positioning.test.mjs` does NOT import `coordinate-calculator.js` or
  `kml-builder.js` — the only files changed by this task. It cannot be affected
  by the bifurcation/KMZ-rendering fix.
- The failures originate from in-progress, uncommitted OCR / post-positioning
  work present in the working tree before this task started:
  `parser/pdf-parser.js`, `parser/post-assembler.js`, `browser/main.js`
  (Viterbi symbol-assignment / OCR outlier repair). These appear as
  ` M` modified files in `git status` and are unrelated to bifurcation drawing.

### Action

Not fixed (SCOPE BOUNDARY — out-of-scope, unrelated files). Tracked here for the
owner of the OCR/positioning work to address.
