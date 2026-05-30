import { readFileSync, writeFileSync } from "node:fs";

const path = "parser/dwg/graph-walker.js";
let src = readFileSync(path, "utf8");

function replaceOnce(needle, replacement) {
  const idx = src.indexOf(needle);
  if (idx === -1) {
    throw new Error("NEEDLE NOT FOUND:\n" + needle.slice(0, 160));
  }
  if (src.indexOf(needle, idx + 1) !== -1) {
    throw new Error("NEEDLE NOT UNIQUE:\n" + needle.slice(0, 160));
  }
  src = src.slice(0, idx) + replacement + src.slice(idx + needle.length);
}

// --- Edit 1: add findBranchReturnArm helper after findMultiHopByLabel ---
replaceOnce(
  "  visit(fromIdx, -1, 0, []);\n  return best;\n}\n\nexport function pairPostsByGraphWalk({",
  `  visit(fromIdx, -1, 0, []);
  return best;
}

/**
 * Branch-return resolver (Option A). When a parallel branch dead-ends at a
 * service stub, the spine resumes from the junction where the branch was first
 * tapped, along that junction's single remaining unclaimed arm.
 *
 * Given the recorded branch-entry junction, find its unclaimed arms. The walk
 * should resume here only when:
 *   (1) the junction has exactly ONE unclaimed arm (the spine continuation), and
 *   (2) that arm fits the consecutive label \`labelM\` within a relaxed tolerance, and
 *   (3) the arm's forward continuation fits the NEXT label strictly better than
 *       the direct (stub) continuation does.
 * Returns { endpoint, intermediates: [] } or null.
 */
function findBranchReturnArm({
  junctionIdx,
  fromIdx,
  labelM,
  nextLabelM,
  directNextDelta,
  richGraph,
  claimed,
  regionPosts,
}) {
  if (junctionIdx == null) return null;
  if (labelM == null || !Number.isFinite(labelM) || labelM <= 0) return null;
  const arms = unclaimedCableNeighbors(junctionIdx, richGraph, claimed);
  // Exactly one remaining arm => the unambiguous spine continuation.
  if (arms.length !== 1) return null;
  const armIdx = arms[0];
  if (armIdx === fromIdx) return null;

  // (2) consecutive-label fit (relaxed: branch-return labels are legacy-midpoint
  // chords that only approximate the junction->next span).
  const armSpan = spanBetween(regionPosts, junctionIdx, armIdx);
  const armTol = Math.max(spanToleranceFor(labelM), 10, 0.35 * labelM);
  if (Math.abs(armSpan - labelM) > armTol) return null;

  // (3) next-label lookahead from the arm must beat the direct stub continuation.
  if (nextLabelM != null && Number.isFinite(nextLabelM)) {
    const armNextDelta = bestNextSpanDeltaFor(
      armIdx,
      junctionIdx,
      regionPosts,
      richGraph,
      claimed,
      [],
      nextLabelM,
    );
    if (!Number.isFinite(armNextDelta)) return null;
    const directNext =
      directNextDelta != null && Number.isFinite(directNextDelta)
        ? directNextDelta
        : Infinity;
    // Require the arm to fit the next label clearly better than the stub.
    if (!(armNextDelta + 1 < directNext)) return null;
  }

  return { endpoint: armIdx, intermediates: [] };
}

export function pairPostsByGraphWalk({`,
);

// --- Edit 2: declare branchEntryStack ---
replaceOnce(
  "  const tapPlacedMainLabel = new Map();\n  buildPostByNumber(posts); // validate; result unused in graph-walk",
  `  const tapPlacedMainLabel = new Map();
  // Branch-entry stack (Option A — Siriu posts 46+). Each time the walk leaves a
  // high-degree junction (deg >= 4, e.g. post 36 / idx 123) with spine arms still
  // unclaimed, we record that junction. The parallel branch eventually dead-ends
  // at a service stub; when that branch terminal is reached and the forward
  // continuation fits the next label poorly, we pop the most recent entry junction
  // and resume along its single remaining unclaimed arm (the spine continuation).
  /** @type {Array<{ junctionIdx: number }>} */
  const branchEntryStack = [];
  buildPostByNumber(posts); // validate; result unused in graph-walk`,
);

// --- Edit 3: branch-return override inside Case A ---
replaceOnce(
  `      // Branch-return jumpback helper (runs BEFORE direct-neighbor logic and BEFORE
      // the labelM==null single-neighbor shortcut). If we have a non-consecutive`,
  `      // Branch-return override (Option A). If a recorded branch-entry junction has
      // exactly one remaining unclaimed arm that fits both the consecutive label and
      // the NEXT label better than the forward (stub) continuation, resume the walk
      // along that spine arm. Gated tightly (single remaining arm + strict next-label
      // lookahead) so it never fires on ordinary spine steps — protecting the frozen
      // Valmor/João Born routes, whose branch terminals (if any) have multiple open
      // arms or a forward continuation that already fits the next label best.
      if (
        chosenIdx === undefined &&
        labelM != null &&
        labelM > 0 &&
        branchEntryStack.length > 0
      ) {
        const nextRoutePostBR = posts[i + 2];
        const nextLabelMBR =
          nextRoutePostBR != null
            ? getDistLabel(distMap, toNum, nextRoutePostBR.number)
            : null;
        // Direct (stub) forward continuation's best next-label delta.
        let directNextDeltaBR = Infinity;
        if (nextLabelMBR != null && Number.isFinite(nextLabelMBR)) {
          for (const nIdx of neighbors) {
            const nd = bestNextSpanDeltaFor(
              nIdx,
              fromIdx,
              regionPosts,
              graph,
              claimed,
              [],
              nextLabelMBR,
            );
            if (nd < directNextDeltaBR) directNextDeltaBR = nd;
          }
        }
        // Try entries from most-recent backwards; pop stale ones (no single arm).
        for (let e = branchEntryStack.length - 1; e >= 0; e--) {
          const entry = branchEntryStack[e];
          const armHop = findBranchReturnArm({
            junctionIdx: entry.junctionIdx,
            fromIdx,
            labelM,
            nextLabelM: nextLabelMBR,
            directNextDelta: directNextDeltaBR,
            richGraph: graph,
            claimed,
            regionPosts,
          });
          if (armHop) {
            chosenIdx = armHop.endpoint;
            chainIntermediates = armHop.intermediates;
            branchEntryStack.splice(e, 1);
            warn({
              kind: "dwg-branch-return",
              at_post: toNum,
              junction_idx: entry.junctionIdx,
              arm_idx: armHop.endpoint,
            });
            break;
          }
        }
      }

      // Branch-return jumpback helper (runs BEFORE direct-neighbor logic and BEFORE
      // the labelM==null single-neighbor shortcut). If we have a non-consecutive`,
);

// --- Edit 4: record branch entry after each committed step ---
replaceOnce(
  `    dwgByNum.set(toNum, regionPosts[chosenIdx]);
    idxByNum.set(toNum, chosenIdx);
    claimed.add(chosenIdx);
    visitedIdx.push(chosenIdx);
    visitedPostNums.push(toNum);
  }`,
  `    dwgByNum.set(toNum, regionPosts[chosenIdx]);
    idxByNum.set(toNum, chosenIdx);
    claimed.add(chosenIdx);
    visitedIdx.push(chosenIdx);
    visitedPostNums.push(toNum);

    // Branch-entry recording (Option A). If the node we just left (fromIdx) is a
    // high-degree junction (deg >= 4) that STILL has unclaimed arms after this
    // step, the walk has tapped off the spine — record the junction so that a
    // later branch terminal can resume along its remaining arm. Dedupe by index.
    if (
      fromIdx != null &&
      (graph.get(fromIdx)?.size ?? 0) >= 4 &&
      unclaimedCableNeighbors(fromIdx, graph, claimed).length > 0 &&
      !branchEntryStack.some((b) => b.junctionIdx === fromIdx)
    ) {
      branchEntryStack.push({ junctionIdx: fromIdx });
    }
  }`,
);

writeFileSync(path, src, "utf8");
console.log("applied 4 edits OK");
