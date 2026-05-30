// For each snap-candidate post, compute current t along chord and label-fraction t
const posts = [
  { num: 1, x: 272.66, y: 444.30 },
  { num: 2, x: 342.38, y: 428.82 },
  { num: 3, x: 436.82, y: 396.78 },
  { num: 4, x: 500.42, y: 356.94 },
  { num: 5, x: 528.38, y: 321.90 },
  { num: 6, x: 597.38, y: 305.82 },
  { num: 7, x: 668.54, y: 261.54 },
  { num: 8, x: 752.54, y: 236.94 },
  { num: 9, x: 849.50, y: 214.98 },
  { num: 10, x: 883.10, y: 201.42 },
  { num: 11, x: 939.50, y: 189.30 },
  { num: 12, x: 986.18, y: 179.34 },
  { num: 13, x: 1048.10, y: 160.86 },
  { num: 14, x: 1139.66, y: 136.38 },
  { num: 15, x: 152.42, y: 283.26 },
  { num: 16, x: 247.58, y: 258.78 },
  { num: 17, x: 349.46, y: 231.66 },
  { num: 18, x: 439.10, y: 206.94 },
  { num: 19, x: 549.98, y: 177.54 },
  { num: 20, x: 637.58, y: 154.62 },
  { num: 21, x: 735.86, y: 129.18 },
  { num: 22, x: 836.42, y: 104.82 },
  { num: 23, x: 949.94, y: 71.70 },
  { num: 24, x: 1037.18, y: 54.42 },
  { num: 25, x: 1133.90, y: 51.84 },
  { num: 26, x: 134.18, y: 330.42 },
  { num: 27, x: 218.18, y: 303.78 },
  { num: 28, x: 310.34, y: 284.46 },
  { num: 29, x: 403.22, y: 262.14 },
  { num: 30, x: 481.46, y: 240.54 },
  { num: 31, x: 590.78, y: 216.30 },
  { num: 32, x: 672.38, y: 193.38 },
  { num: 33, x: 765.02, y: 167.46 },
  { num: 34, x: 847.70, y: 116.70 },
];
const labels = {
  '1->2': 22.7, '2->3': 37.4, '3->4': 38.9, '4->5': 13.35,
  '5->6': 25.2, '6->7': 28.5, '7->8': 34.8, '8->9': 34.0,
  '9->10': 17.8, '10->11': 14.1, '11->12': 10.9, '12->13': 27.6, '13->14': 36,
  '15->16': 33.3, '16->17': 35.4, '17->18': 31.2, '18->19': 37, '19->20': 35.4,
  '20->21': 36.7, '21->22': 36.4, '22->23': 35.4, '23->24': 36.7, '24->25': 35.2,
  '26->27': 32.1, '27->28': 33.4, '28->29': 33.1, '29->30': 25.6, '30->31': 36.6,
  '31->32': 33.5, '32->33': 37.1, '33->34': 34,
};

// snap candidates from warnings: 2, 7, 8, 12, 19, 22, 23, 24, 33
const candidates = [2, 7, 8, 12, 19, 22, 23, 24, 33];
const pByNum = new Map(posts.map(p => [p.num, p]));
console.log("Post | label-frac | pdf-frac | move(pt) | pdf-chord-tot | label-tot | diff");
for (const num of candidates) {
  const prev = pByNum.get(num - 1);
  const post = pByNum.get(num);
  const next = pByNum.get(num + 1);
  if (!prev || !post || !next) continue;
  const lblBefore = labels[`${prev.num}->${post.num}`];
  const lblAfter = labels[`${post.num}->${next.num}`];
  if (lblBefore == null || lblAfter == null) continue;
  // PDF chord prev->next
  const dx = next.x - prev.x, dy = next.y - prev.y;
  const chord_pdf = Math.hypot(dx, dy);
  const chord_m = chord_pdf * 0.354610;
  // Current post t along chord prev->next:
  const t_cur = ((post.x - prev.x) * dx + (post.y - prev.y) * dy) / (chord_pdf * chord_pdf);
  // Label fraction:
  const t_lbl = lblBefore / (lblBefore + lblAfter);
  // Move distance:
  const snapX = prev.x + t_lbl * dx, snapY = prev.y + t_lbl * dy;
  const move = Math.hypot(post.x - snapX, post.y - snapY);
  console.log(`  ${num.toString().padStart(2)}: lbl-frac=${t_lbl.toFixed(3)} cur-frac=${t_cur.toFixed(3)} (Δ=${(t_cur - t_lbl).toFixed(3)}) move=${move.toFixed(1)}pt | chord_m=${chord_m.toFixed(1)} lbl_sum=${(lblBefore+lblAfter).toFixed(1)} diff=${(chord_m - (lblBefore+lblAfter)).toFixed(1)}m`);
}
