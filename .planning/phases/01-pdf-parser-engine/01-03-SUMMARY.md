---
phase: 01-pdf-parser-engine
plan: "03"
subsystem: browser-ui
tags: [html, esm, file-input, pdf-parser, browser]
dependency_graph:
  requires: [01-02]
  provides: [index.html browser entry point]
  affects: [end-to-end parse flow, Phase 2 coordinate form placeholder]
tech_stack:
  added: []
  patterns: [ESM module import, FileReader arrayBuffer, DOM manipulation, inline styles]
key_files:
  created:
    - index.html
  modified: []
decisions:
  - "D-15 continuous flow: coordForm shown immediately on success, no confirmation gate"
  - "D-14 simple summary: posts.length, distances.length, cableSegments.length counts displayed"
  - "D-07 warnings: all parser warnings shown in #warnings section after success or parse_failed"
  - "T-03-01 size guard applied before arrayBuffer() call (file.size > 50 MB threshold)"
  - "T-03-02 outer try/catch wraps entire parsePdf() call to prevent unhandled DOM exceptions"
metrics:
  duration: "38s"
  completed: "2026-05-14"
  tasks_completed: 1
  tasks_total: 2
  files_created: 1
  files_modified: 0
---

# Phase 1 Plan 03: Browser UI (index.html) Summary

**One-liner:** Single-file browser entry point wiring parsePdf() to a file input with size guard, three-shape result handling, and immediate D-15 coordinate form unlock.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Build index.html with file input, size guard, and result display | 5b2827d | index.html (created) |
| 2 | Verify end-to-end parse on real sample PDF | — | CHECKPOINT (awaiting human verify) |

## What Was Built

**index.html** — a single-file browser app (no bundler, no external CSS framework) that:

1. Presents a `<input type="file" id="pdfInput" accept=".pdf">` file picker
2. Applies a 50 MB size guard **before** calling `file.arrayBuffer()` (T-03-01)
3. Imports `{ parsePdf }` from `./parser/pdf-parser.js` via `<script type="module">` (workerSrc set by pdf-parser.js at module load)
4. Wraps the full parse in `try/catch` to prevent any exception from reaching the DOM unhandled (T-03-02)
5. Handles all three parsePdf() result shapes:
   - **missing_layers**: shows missing layer names and all available layer names in red status
   - **parse_failed**: shows the error message in red status; also displays any partial warnings
   - **success**: shows green "Parse complete.", a summary list with post/distance/cable segment counts, the `#coordForm` section immediately (D-15), and any warnings in a styled `#warnings` section
6. Uses plain DOM manipulation (textContent, createElement, style.display) — no frameworks

## Acceptance Criteria Verification

- [x] `<input type="file" id="pdfInput" accept=".pdf">` present
- [x] `import { parsePdf } from './parser/pdf-parser.js'` in script type="module"
- [x] `file.size > 50 * 1024 * 1024` guard before arrayBuffer() call
- [x] Handler for `result.error === 'missing_layers'` — shows missing and allNames
- [x] Handler for `result.error === 'parse_failed'` — shows message
- [x] Success path shows posts.length, distances.length, cableSegments.length
- [x] `#coordForm` shown on success without confirmation gate (D-15)
- [x] `result.warnings` displayed when length > 0
- [x] Does NOT use fetch() — only FileReader/arrayBuffer() from user file input
- [x] Does NOT import pdfjs-dist directly — uses parsePdf from parser/pdf-parser.js

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

| File | Element | Reason |
|------|---------|--------|
| index.html | `#coordForm` content: "Coming in Phase 2" | Intentional placeholder per plan — Phase 2 will wire GPS coordinate inputs |

## Threat Flags

No new security surface beyond what is documented in the plan's threat model (T-03-01 through T-03-04). All `mitigate` dispositions implemented.

## Self-Check

Files created:
- index.html: EXISTS (committed at 5b2827d)

Commits:
- 5b2827d: feat(01-03): build index.html browser entry point

## Self-Check: PASSED
