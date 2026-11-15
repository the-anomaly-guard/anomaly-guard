// Extra points along the straight parts of a line, for the hover only. Chart.js shows the tooltip
// of the nearest POINT, so a long segment with points only at its ends cannot be hovered anywhere in
// between: the ROC curve of the rules has a single inner point (a rule matches or not), and its two
// long segments showed no tooltip at all. The added points lie exactly on the drawn line, are not
// drawn themselves, and are marked, so a tooltip can say they sit between two real points. Pure.

/**
 * @param {{ x: number, y: number }[]} points  in drawing order
 * @param {number} step  the largest gap left along x or along y, in axis units
 * @param {boolean} [mark]  flag the added points with `between: true`
 * @returns {{ x: number, y: number, between?: true }[]}
 */
export function densify(points, step, mark = true) {
  if (!(step > 0)) throw new RangeError('densify: step must be a positive number');
  /** @type {{ x: number, y: number, between?: true }[]} */
  const out = [];
  points.forEach((p, i) => {
    if (i > 0) {
      const q = points[i - 1];
      const n = Math.ceil(Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y)) / step);
      for (let k = 1; k < n; k++) {
        const added = { x: q.x + ((p.x - q.x) * k) / n, y: q.y + ((p.y - q.y) * k) / n };
        out.push(mark ? { ...added, between: true } : added);
      }
    }
    out.push({ x: p.x, y: p.y });
  });
  return out;
}
