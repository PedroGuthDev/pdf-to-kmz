---
status: partial
trigger: Coordinates work on Valmor PDF but are way off on Joao Born PDF (34 posts, reference coords in folder)
created: 2026-05-18
updated: 2026-05-19
---

## Symptoms

- **Expected:** GPS within ~5m of reference for all posts on Joao Born PDF
- **Actual (best harness):** Post 1 OK (~0m); max **46.07 m** at post 25; 4/34 < 5 m
- **Actual (true Poste snaps):** max **~648 m** with `fixtures/joao-born-browser-posts.json`
- **Reproduction:** `node debug-run-calc.mjs joao-born` (PARSE DEBUG positions)

## Harness (2026-05-19)

| Mode | Positions | Max error |
|------|-----------|-----------|
| Default | `debug_results.txt` PARSE DEBUG only (no calc dump lines) | **46.07 m** |
| `--browser-posts` | `fixtures/joao-born-browser-posts.json` | ~648 m |
| `--parser-posts` | Node OCR | varies |

**Numbering mismatch:** PARSE DEBUG labels post 1 at PDF coords (268.82, 421.50) — same physical location as **route post 14** in browser fixture (1152.50, 159.66 is route post 1). The 46 m result pairs reference GPS for post 1 with parser-export numbering, not browser Poste order.

## Current Focus

next_action: Improve page 4 band (~28–46 m) and page 5 tail (~36 m) on PARSE DEBUG harness; fix true Poste snap pipeline (scale at route post 1) separately.

## Fix applied (2026-05-19)

- `fillAdjacentMissingDistances` before global label LSQ (same-page gaps 4→5, etc.)
- Harness: PARSE DEBUG block only; `--browser-posts` for fixture
- Page 5 label chain skip posts 28–29 only (commit 62849f7)

## Eliminated

- Page 5 seam lock at post 26 → ~292 m (worse)
- UTM-only page 4 posts 16–25 → ~189 m (worse)
- Extend page 5 chain skip to 28–31 → ~72 m (worse)
