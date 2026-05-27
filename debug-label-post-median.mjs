import { readFileSync } from "fs";
import { parsePdf } from "./parser/pdf-parser.js";

const buf = readFileSync("./INFOVIAS_PJC INTERNET_Palhoça_RUA JOAO BORN_v04.pdf");
const parsed = await parsePdf(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);
for (const pg of [3, 4, 5]) {
  const w = parsed.pageDimensions.get(pg)?.w ?? 1191;
  const posts = parsed.posts.filter((p) => p.pageNum === pg);
  const labels = (parsed.distanceLabelItems ?? []).filter(
    (d) => (d.pageNum ?? 1) === pg && /^\d/.test(d.str?.trim()),
  );
  const mx = posts.reduce((s, p) => s + p.x, 0) / posts.length;
  const lx =
    labels.reduce((s, d) => s + d.x + (d.width ?? 0) * 0.5, 0) / labels.length;
  console.log(
    `page ${pg}: meanPostX=${mx.toFixed(0)} meanLabelX=${lx.toFixed(0)} w=${w} gap=${Math.abs(mx - lx).toFixed(0)} mirror?=${Math.abs(mx - lx) > w * 0.35}`,
  );
}
