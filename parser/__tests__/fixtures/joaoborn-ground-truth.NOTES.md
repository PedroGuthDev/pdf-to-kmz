# João Born ground truth — provenance notes

Source: `coordenadas postes rua joao born.txt` (surveyor GPS walk, 34 posts;
the txt's "Poste 35" is a stray point hundreds of km away and was never
ingested).

## Posts 9–11 corrected from DXF pole positions (2026-06-11)

The surveyor's walk is off by one pole through the dense front section.
Evidence (see solver-first acceptance work, JB front labels):

- The printed Distância_Poste chain matches the Palhoca.dxf CELESC pole
  chain EXACTLY in street order: 8→9 = 34.0 m ("34"), 9→10 = 18.0 m
  ("17,8"), 10→11 = 14.1 m ("14,1"), 11→12 = 10.9 m ("10,9"),
  12→13 = 27.7 m ("27,6"), 13→14 = 36.1 m ("36") — six consecutive exact
  printed↔DXF matches identify the route poles unambiguously.
- The surveyor's own recorded spans fit the SHIFTED interpretation:
  their 11→12 gap (25.2 m) equals real spans 10→11 + 11→12
  (14.1 + 10.9 = 25.0 m) — they skipped the pole 10.9 m before post 12.
- Original GPS point 9 sat mid-span between real poles 8 and 9 (a phantom
  fix, 4.3 m from the span midpoint); original point 10 sat on real pole 9
  (4.2 m); original point 11 sat on real pole 10 (4.1 m). Points 1–8 and
  12–34 align with their DXF poles within 2–5 m (GPS noise) and were kept.

Posts 9, 10, 11 carry UTM→lat/lon conversions of the DXF poles
(zone 22S) that close the printed chain: each is within 0.8 m of the
printed span walk from post 8 and rejoins the untouched post 12 with a
10.94 m closing span (printed 10,9).
