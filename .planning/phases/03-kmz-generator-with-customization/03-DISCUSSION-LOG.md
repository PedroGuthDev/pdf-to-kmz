# Phase 3: KMZ Generator with Customization - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-26
**Phase:** 03-KMZ Generator with Customization
**Areas discussed:** Placemark content, Route line topology, Icon customization, Customization API

---

## Placemark content

| Option | Description | Selected |
|--------|-------------|----------|
| Poste 07 (zero-padded) | Matches console preview | ✓ |
| Poste 7 (no padding) | Matches REQUIREMENTS wording | |
| 07 only | Number without prefix | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal lat/lon only | | ✓ |
| Coords + postType | | |
| Rich (coords, type, page, distance) | | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Skip + summary count | Omit null GPS; report count | ✓ |
| Skip only | | |
| Placeholder at 0,0 | | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| clampToGround | Pins hug terrain | ✓ |
| relativeToGround + offset | | |
| absolute altitude 0 | | |
| You decide | | |

**User's choice:** Zero-padded `Poste NN` names; minimal balloon; skip null-GPS with omitted count; clampToGround.

---

## Route line topology

| Option | Description | Selected |
|--------|-------------|----------|
| One LineString per connection | Matches Phase 2 graph | ✓ |
| Folder per page / single master line | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Same style for gaps | | ✓ |
| Dashed gaps | | |
| Omit gap lines | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Same style for branches | | ✓ |
| Secondary branch color | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Always draw cross_page lines | | ✓ |
| Dashed cross_page | | |
| Omit cross_page | | |

**Follow-up (user):** Route lines must support a **description filled by user input**.

| Option | Description | Selected |
|--------|-------------|----------|
| One global description for all lines | Single text field | ✓ |
| Per-segment descriptions | | |

**User's choice:** Per-connection geometry; uniform styling for gap/branch/cross_page; global `lineDescription` on all line placemarks.

---

## Icon customization

| Option | Description | Selected |
|--------|-------------|----------|
| Built-in GE icon URLs | No PNG in ZIP | ✓ |
| Bundled PNGs | | |

**User's choice (free text):** Mainly the **square with outer line and small filled square inside** (framed square).

| Option | Description | Selected |
|--------|-------------|----------|
| Google Earth built-in square URL | Verify in Earth | ✓ |
| Bundled custom PNG | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed scale 1.0 | No size v1 | ✓ |
| Presets / slider | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Google Earth preset colors | | ✓ |
| Hex / named app presets | | |

---

## Customization API

| Option | Description | Selected |
|--------|-------------|----------|
| Two-step buildKml + packageKmz | | ✓ |
| Single generateKmz function | | |
| Builder class | | |

| Option | Description | Selected |
|--------|-------------|----------|
| parser/kmz-defaults.js | | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| Full line + label options in Phase 3 | Phase 4 wires UI | ✓ |
| Line only / presets only | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Dev-only Download KMZ hook | Hardcoded defaults | ✓ |
| Minimal style inputs now | | |
| No index.html changes | | |

**User's choice:** Two-step API, defaults file, full style options object, dev download button only.

---

## Claude's Discretion

- Exact square icon `href` after Earth verification
- Preset color mapping table
- KMZ filename pattern
- Optional `generateKmz` wrapper
- Shared `<Style>` vs inline styles

## Deferred Ideas

- Per-segment line descriptions
- Rich placemarks
- Icon size customization (Phase 4)
- Branch/cross-page/gap distinct line styles
- Map preview (ENH-01)
