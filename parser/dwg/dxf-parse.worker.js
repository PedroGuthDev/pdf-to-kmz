import { parseDxfText } from "./dxf-loader.js";
import { buildPostIndex } from "./region-pairing.js";

self.onmessage = (e) => {
  if (e.data?.type !== "PARSE_DXF") {
    self.postMessage({
      ok: false,
      error: "unknown message type",
    });
    return;
  }

  try {
    const { posts, cableEdges, primaryCableEdges, extmin, extmax } =
      parseDxfText(e.data.dxfText);
    const rbushDump = buildPostIndex(posts).toJSON();
    self.postMessage({
      ok: true,
      posts,
      cableEdges,
      primaryCableEdges,
      rbushDump,
      extmin,
      extmax,
    });
  } catch (err) {
    self.postMessage({
      ok: false,
      error: String(err?.message ?? err),
    });
  }
};
