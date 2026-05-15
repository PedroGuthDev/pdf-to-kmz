# Phase 2: Coordinate Calculator — Research

**Researched:** 2026-05-15
**Scope:** GPS projection math, bearing computation from PDF coordinates, branch/gap detection algorithms, codebase integration constraints

---

## 1. Bearing Calculation from PDF Coordinates

### Coordinate System After flipY

After `flipYInOp` (applied in `pdf-parser.js`):
- **Origin:** Top-left corner of the page
- **+x axis:** Rightward (East on the map)
- **+y axis:** Downward (South on the map — y increases as you move down the page)
- **North = -y direction** (smaller y = higher on page = further north)

### Correct Bearing Formula

For a compass bearing where 0° = North, 90° = East:

```
bearing = atan2(east_component, north_component)
        = atan2(dx, -dy_page)
        = atan2(next.x - curr.x, curr.y - next.y)
```

**Verification:**
- Post directly north (same x, smaller y): `atan2(0, positive)` = **0°** ✓
- Post directly east (larger x, same y): `atan2(positive, 0)` = **90°** ✓
- Post directly south (same x, larger y): `atan2(0, negative)` = **180°** ✓
- Post directly west (smaller x, same y): `atan2(negative, 0)` = **270°** ✓

Normalize to 0–360: `(atan2(...) * 180 / PI + 360) % 360`

### ⚠ CRITICAL: Double-Negation Trap

CONTEXT D-02 says: "atan2(dx, dy) on PDF coordinates."
If you define `dy = -(next.y - curr.y)` (the northward component) AND THEN pass `atan2(dx, -dy)`, you double-negate:
```
atan2(dx, -dy) = atan2(dx, -(-(next.y - curr.y))) = atan2(dx, next.y - curr.y)
```
This produces **180° inverted bearings** (north reads as south). The correct call is **`atan2(dx, dy)`** where `dy = curr.y - next.y`, or equivalently **`atan2(next.x - curr.x, curr.y - next.y)`**.

---

## 2. GPS Projection: Flat-Earth vs Spherical

### Flat-Earth Approximation (D-05)

Standard equirectangular projection for short distances:
```
dLat = (meters * cos(bearingRad)) / 111320
dLon = (meters * sin(bearingRad)) / (111320 * cos(lat * PI / 180))
```

- 111,320 meters ≈ 1 degree of latitude (at SIRGAS-2000/WGS-84 reference)
- `cos(lat)` correction accounts for longitude convergence at higher latitudes

### Error Analysis for Palhoça, SC (lat ≈ -27.6°)

At 40m between posts (typical), flat-Earth vs haversine difference:
- **Latitude error:** < 0.000001° ≈ 0.1mm — negligible
- **Longitude error:** < 0.000001° ≈ 0.1mm — negligible
- **Cumulative error over 20 posts (~800m):** < 0.01m — negligible

**Conclusion:** Flat-Earth is perfectly adequate for this use case. The haversine formula from movable-type.co.uk is overkill for inter-post distances of tens of meters.

### Spherical Destination Point (Reference Only)

For distances > 10km, the proper formula (from movable-type.co.uk):
```javascript
φ2 = asin(sin(φ1) * cos(δ) + cos(φ1) * sin(δ) * cos(θ))
λ2 = λ1 + atan2(sin(θ) * sin(δ) * cos(φ1), cos(δ) - sin(φ1) * sin(φ2))
```
Where `δ = distance / R`, `R = 6371e3`. Not needed here, but available if accuracy requirements change.

---

## 3. Codebase Integration Constraints

### Cable Segments Lose pageNum

**Finding:** `pdf-parser.js` line 411 strips `pageNum`:
```javascript
buildCableSegments(allCablePaths.map(r => r.ops), [])
```

`allCablePaths` entries have `{ pageNum, ops }`, but only `ops` is passed. This means `cableSegments` have no page context.

**Impact on gap detection:** For gap detection (D-10), we need to check if a cable path passes near two posts. Since detail pages (3+) share the same coordinate system (D-03), cable ops have absolute coordinates in a unified space. The `minDistancePointToPathOps` function works with absolute coordinates, so **pageNum is not needed** for proximity checks. However, page 2 cables (overview scale) may have different coordinates — they should not interfere since posts from page 2 are excluded by D-04.

### distance-associator Only Pairs Sequential Posts

**Finding:** `associateDistances()` sorts posts by number and pairs N → N+1. It does NOT produce entries for branch connections (e.g., post 7 → post 16).

**Impact:** Branch junction distances must be computed differently:
1. Check `distances[]` first (in case an adjacent distance label happens to match)
2. Fall back to scale factor estimation: `scaleFactor = avg(meters / pdfDistance)` from known pairs, then `estimated_meters = pdfDistance * scaleFactor`

### The coordForm Section Already Exists

**Finding:** `index.html` lines 99-102 already have a `<section id="coordForm">` placeholder:
```html
<section id="coordForm">
  <h2>Step 2: Enter First Post Coordinates</h2>
  <p>Coming in Phase 2</p>
</section>
```

This section is already shown after successful parse (line 233). Plans should modify this existing section, not create a duplicate.

### deduplicatePostsPreferLowerPage Keeps Page 2

**Finding:** Current dedup keeps the occurrence with the **lowest** page number. Page 2 is the overview (different scale, unreliable positions). D-04 says to prefer detail pages (3+) for coordinate accuracy.

**Approach options:**
1. **Change dedup globally** — change `pPage < prevPage` to `pPage > prevPage`. Simple but affects Phase 1 output shape (posts that had page 2 positions now have page 3+ positions).
2. **Filter page 2 posts in coordinate calculator** — leave dedup alone, exclude page 2 data in Phase 2. More isolated but adds complexity.
3. **Skip page 2 entirely in the parser** — prevent page 2 from being OCR'd. Too aggressive, breaks overview.

**Recommendation:** Option 1 (change dedup globally). The positions from detail pages are more accurate. Phase 1 output contract shape (`{ number, x, y, pageNum }`) doesn't change — only which page's coordinates are retained. Distances and cable segments are unaffected.

---

## 4. Branch Detection Algorithm

### Number-Gap Heuristic

Posts are numbered sequentially: main route 1–15, branch 16–22. Detection:
1. Sort posts by number
2. Walk the sequence — when `post[i+1].number - post[i].number > 1`, that's a potential branch boundary
3. BUT: OCR can miss numbers too, creating false gaps. Mitigations:
   - Only flag a gap as a branch start if the posts are spatially **far apart** in PDF space (hundreds of PDF points)
   - If posts are spatially close (< 100pt), it's likely an OCR miss, not a branch

### Junction Detection via Spatial Proximity

For branch start post B (e.g., post 16), find the nearest existing post on the main route or earlier branch. This is the junction:
```
junction = argmin(distance(B, mainPost)) for all mainPosts
```

In PDF coordinate space (unified across detail pages), this is a simple nearest-neighbor search. O(n²) is fine for 20-30 posts.

### Edge Case: Multiple Branches from Same Junction

INFOVIAS PDFs can have multiple branches forking from the same post. Each branch is a separate number sequence. The algorithm handles this naturally — each branch independently finds its nearest junction post.

---

## 5. Gap Detection Algorithm

### Definition (D-10)

A gap = sequential posts (e.g., 10→11) with **no cable polyline** connecting them. The numbering is continuous but the `Cabo Projetado` geometry is disconnected.

### Detection Approach

For each sequential post pair (N → N+1):
1. Check if ANY cable segment passes within a threshold distance (e.g., 50 PDF points) of BOTH posts
2. If no cable connects them → gap

```
isGap(postA, postB, cableSegments) {
  for each segment in cableSegments:
    dA = minDistancePointToPathOps(postA.x, postA.y, segment.ops)
    dB = minDistancePointToPathOps(postB.x, postB.y, segment.ops)
    if dA < threshold AND dB < threshold: return false  // cable connects them
  return true  // no cable found
}
```

**Threshold consideration:** 50 PDF points is generous — cables typically pass within 5-20pt of their associated posts. This threshold accounts for posts that are slightly offset from the cable centerline.

### Scale Factor for Gap-Crossing Distances

When a gap exists, there's no distance label. Estimate from the PDF layout:
```
scaleFactor = sum(meters) / sum(pdfDistance) for all known-distance pairs
estimated_meters = hypot(postB.x - postA.x, postB.y - postA.y) * scaleFactor
```

---

## 6. Output Contract Changes

### calculateCoordinates Return Shape

Phase 1 returns: `{ posts, distances, cableSegments, warnings, layerMap }`

Phase 2 adds a **post-processing step** (not inside parsePdf). The coordinate calculator:
- **Input:** `posts[], distances[], cableSegments[], startLat, startLon`
- **Output:** `{ posts (enriched with lat/lon), connections[] }`

This is a separate function called AFTER parsePdf(), keeping the Phase 1 contract clean.

### connections[] Shape (D-17)

```
{ from: number, to: number, meters: number, bearing: number, gap: boolean }
```

Phase 3 uses this to:
- Draw lines between connected posts (where `gap: false`)
- Skip line drawing where `gap: true`
- Use bearing/meters for debugging and metadata

---

## RESEARCH COMPLETE

Key findings that affect plans:
1. **Bearing formula has a double-negation bug** — must use `atan2(dx, currY - nextY)`, not `atan2(dx, -dy)` where dy is already negated
2. **Cable segments lack pageNum** — not a problem because detail pages share coordinate space
3. **coordForm already exists in index.html** — modify existing, don't duplicate
4. **distance-associator doesn't handle branch pairs** — scale factor fallback needed
5. **Flat-Earth approximation is adequate** — error < 0.01m over full route
