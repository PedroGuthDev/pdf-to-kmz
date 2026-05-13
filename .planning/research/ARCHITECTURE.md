# Architecture Research: PDF to KMZ Converter

## Component Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Web UI Layer                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ PDF      │  │ GPS      │  │ Customization     │  │
│  │ Upload   │  │ Input    │  │ Panel             │  │
│  └────┬─────┘  └────┬─────┘  └────────┬──────────┘  │
│       │              │                 │             │
├───────┼──────────────┼─────────────────┼─────────────┤
│       ▼              │                 │             │
│  ┌──────────────┐    │                 │             │
│  │ PDF Parser   │    │                 │             │
│  │ (pdf.js)     │    │                 │             │
│  │              │    │                 │             │
│  │ → text items │    │                 │             │
│  │ → positions  │    │                 │             │
│  └──────┬───────┘    │                 │             │
│         ▼            │                 │             │
│  ┌──────────────┐    │                 │             │
│  │ Data         │    │                 │             │
│  │ Extractor    │◄───┘                 │             │
│  │              │                      │             │
│  │ → post IDs   │                      │             │
│  │ → distances  │                      │             │
│  │ → bearings   │                      │             │
│  │ → topology   │                      │             │
│  └──────┬───────┘                      │             │
│         ▼                              │             │
│  ┌──────────────┐                      │             │
│  │ Coordinate   │                      │             │
│  │ Calculator   │                      │             │
│  │              │                      │             │
│  │ → GPS coords │                      │             │
│  │   for each   │                      │             │
│  │   post       │                      │             │
│  └──────┬───────┘                      │             │
│         ▼                              │             │
│  ┌──────────────┐                      │             │
│  │ KML Builder  │◄─────────────────────┘             │
│  │              │                                    │
│  │ → styles     │                                    │
│  │ → placemarks │                                    │
│  │ → lines      │                                    │
│  └──────┬───────┘                                    │
│         ▼                                            │
│  ┌──────────────┐                                    │
│  │ KMZ Packager │                                    │
│  │ (JSZip)      │                                    │
│  │              │                                    │
│  │ → doc.kml    │                                    │
│  │ → .kmz blob  │                                    │
│  └──────┬───────┘                                    │
│         ▼                                            │
│  ┌──────────────┐                                    │
│  │ Download     │                                    │
│  │ Handler      │                                    │
│  └──────────────┘                                    │
└─────────────────────────────────────────────────────┘
```

## Data Flow

1. **User uploads PDF** → ArrayBuffer passed to pdf.js
2. **pdf.js parses pages 2-4** → text items with str + transform[4,5] (x,y positions)
3. **Data Extractor processes text items:**
   - Identifies posts by pattern matching (5-digit IDs, pole type codes)
   - Groups nearby text items to associate: post ID + pole type + position
   - Extracts distances (decimal numbers like "34,3") and associates with nearest post pairs
   - Builds route topology: which posts connect to which, detecting branches/gaps
4. **User provides first post GPS** → lat, lng input
5. **Coordinate Calculator:**
   - Takes PDF x,y positions and normalizes to relative positions
   - Calculates bearings between connected posts from x,y delta
   - Starting from first post GPS, walks the topology graph
   - Applies haversine destination formula: (lat, lng) + bearing + distance → new (lat, lng)
6. **KML Builder:**
   - Reads customization settings (icon, line, label styles)
   - Generates `<Style>` elements
   - Generates `<Placemark>` with `<Point>` for each post
   - Generates `<Placemark>` with `<LineString>` for each connection
7. **KMZ Packager:** JSZip wraps KML as `doc.kml` in ZIP archive
8. **Download:** Blob URL triggers browser download

## Key Design Decisions

### Post Identification Strategy
Posts in the PDF are identified by:
- **Pole ID**: 5-digit numbers (21169, 21170, 21171, etc.) — from utility company
- **Pole type**: Pattern like "10-150 (U)", "11-300 (U)" — indicates height and strength
- **Position**: x,y coords from PDF text transform matrix

The extractor needs to group these: a pole ID and pole type near the same x,y position belong to the same post.

### Route Topology Detection
The PDF shows posts along streets with distances labeled between them. The topology is:
- Posts along the same street are sequential (connected by distance labels)
- Street intersections create branches
- The extractor needs to determine which posts connect based on:
  1. Proximity on the PDF drawing
  2. Presence of distance labels between them
  3. Street name context

### Bearing Calculation from PDF Coordinates
- PDF x,y positions reflect the real-world spatial layout (map view)
- Delta between consecutive post x,y → bearing angle
- `atan2(deltaX, deltaY)` gives the bearing (with PDF Y-axis adjustment)
- This bearing is then used with the haversine destination formula

## Suggested Build Order

1. **PDF Parser** — foundation, everything depends on extracted data
2. **Data Extractor** — transforms raw text into structured post data
3. **Coordinate Calculator** — needs extracted data as input
4. **KML Builder** — needs coordinates as input
5. **KMZ Packager** — wraps KML output
6. **Web UI** — ties all components together

---
*Researched: 2026-05-12*
