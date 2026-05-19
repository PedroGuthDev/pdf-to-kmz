# UTM grid coordinate label detection (N7 / G-3)

Generated: 2026-05-19

**G-3 verdict:** `dropped-no-source` — 0 explicit E/N-suffixed hits across all PDFs.

| PDF | Pages | Total pattern hits | E/N axis hits | Feasible |
|-----|-------|-------------------|---------------|----------|
| valmor | 8 | 0 | 0 | no |
| joao_born | 9 | 0 | 0 | no |
| luiz_carolino | 9 | 0 | 0 | no |
| siriu | 12 | 0 | 0 | no |

## Per-page matches (E/N suffix only)

### Palhoça — Valmor Francisco v1

_No explicit easting/northing axis labels found on this PDF._

### Palhoça — Joao Born v04

_No explicit easting/northing axis labels found on this PDF._

### São José — Luiz Carolino Pereira v1 (AAF)

_No explicit easting/northing axis labels found on this PDF._

### Garopaba — Praia do Siriu v01

_No explicit easting/northing axis labels found on this PDF._

## Patterns searched

- `easting_suffix_E`: `\b(\d{6,7})\s*[mM]?\s*[Ee]\b`
- `northing_suffix_N`: `\b(\d{6,7})\s*[mM]?\s*[Nn]\b`
- `comma_grouped`: `\b(\d{3,4})[\s,](\d{3})\b`
- `plain_6_7_digit`: `\b(\d{6,7})\b`

Plain 6–7 digit numbers are ignored unless paired with E/N (too many false positives).
