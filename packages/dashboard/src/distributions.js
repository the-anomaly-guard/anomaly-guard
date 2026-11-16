// Distributions behind the "Lengths and scores" chart of the Models page (E-02, theme T2): how long
// the parameter values of legitimate and of attack requests are, and what statistical score they
// get, as the share of each class in every bin. Pure: no DOM, tested in Node. The labels come from
// the simulator and are used for the picture only, never by the detector (ADR-004).

import { scoreRequest } from '@anomaly-guard/core';

/** Lower edge of each length bin (characters); the last bin is open: 200 or more. */
export const LENGTH_EDGES = Object.freeze([0, 5, 10, 20, 50, 100, 200]);

/** Lower edge of each score bin (-log10 p); the last bin is open: 10 or more. */
export const SCORE_EDGES = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

/**
 * @typedef {Object} Point  one test request, as the chart needs it
 * @property {boolean} attack  ground truth (the picture only)
 * @property {number} length  length of its longest parameter value
 * @property {number} score   the statistical score, whatever the detector's mode
 */

/**
 * Length of the longest parameter value (0 without parameters).
 * @param {{ params: Record<string, unknown> }} request
 * @returns {number}
 */
export function longestValue(request) {
  let longest = 0;
  for (const value of Object.values(request.params)) {
    longest = Math.max(longest, String(value ?? '').length);
  }
  return longest;
}

/**
 * Length and statistical score of every test request. The score is the one of `scoreRequest`
 * (ADR-007), computed here and not taken from `detect`, so that it exists in every mode (rules
 * mode has no statistical score of its own).
 * @param {{ dataset: { test: any[] }, model: import('@anomaly-guard/core').StatModel }} run
 * @returns {Point[]}
 */
export function pointsOf({ dataset, model }) {
  return dataset.test.map((sample) => ({
    attack: sample.label === 'attack',
    length: longestValue(sample.request),
    score: scoreRequest(model, sample.request).score,
  }));
}

/**
 * Text of each bin: "0-4", "5-9", ... and "200+" (integers), or "0-1", ... "10+" with a step.
 * @param {readonly number[]} edges  lower edges, ascending
 * @returns {string[]}
 */
export function binLabels(edges) {
  return edges.map((low, i) => {
    if (i === edges.length - 1) return `${low}+`;
    const high = edges[i + 1];
    return high - low === 1 ? `${low}` : `${low}-${high - 1}`;
  });
}

/**
 * Index of the bin a value falls in (the last bin takes everything above).
 * @param {readonly number[]} edges
 * @param {number} value
 * @returns {number}
 */
export function binOf(edges, value) {
  let bin = 0;
  for (let i = 0; i < edges.length; i++) if (value >= edges[i]) bin = i;
  return bin;
}

/**
 * Share of the legitimate and of the attack requests in every bin (each class adds up to 1, so the
 * ten percent of attacks are not hidden behind the legitimate majority), with the counts.
 * @param {Point[]} points
 * @param {'length' | 'score'} field
 * @param {readonly number[]} edges
 * @returns {{ labels: string[], legit: number[], attack: number[],
 *   legitCount: number[], attackCount: number[] }}
 */
export function histogram(points, field, edges) {
  const legitCount = new Array(edges.length).fill(0);
  const attackCount = new Array(edges.length).fill(0);
  for (const p of points) (p.attack ? attackCount : legitCount)[binOf(edges, p[field])]++;
  const share = (counts) => {
    const total = counts.reduce((a, b) => a + b, 0);
    return counts.map((c) => (total === 0 ? 0 : c / total));
  };
  return {
    labels: binLabels(edges),
    legit: share(legitCount),
    attack: share(attackCount),
    legitCount,
    attackCount,
  };
}

/**
 * Where a threshold falls on a category axis whose bins are `edges`: the bin's index plus the
 * fraction of the bin it is inside, minus a half (bin i is drawn centred on i). Null when it lies
 * beyond the last bin's start by more than the step of the axis (the last bin is open).
 * @param {readonly number[]} edges  equal steps (SCORE_EDGES)
 * @param {number} threshold
 * @returns {number}
 */
export function thresholdPosition(edges, threshold) {
  const step = edges[1] - edges[0];
  const last = edges.length - 1;
  const bin = Math.min(binOf(edges, threshold), last);
  const within = bin === last ? 0 : (threshold - edges[bin]) / step;
  return bin + within - 0.5;
}
