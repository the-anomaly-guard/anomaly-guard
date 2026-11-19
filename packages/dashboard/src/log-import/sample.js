// A sample access log, written from the simulated traffic (E-10, ADR-016): legitimate requests
// first, then a stretch with 10% attacks, in the Apache combined format. It lets anyone try the
// Import logs page without a real log, and it gives the tests a log whose answers are known.
// Seeded, like everything else (no Math.random). Pure: no DOM, tested in Node.
//
// Access logs record no request body, so every parameter goes in the query string, also for the
// POST endpoints of the simulation. Addresses are from the documentation ranges (RFC 5737).

import { buildDataset, createRng } from '@anomaly-guard/traffic';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NETWORKS = ['192.0.2', '198.51.100', '203.0.113'];
const AGENTS = [
  'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
];

/** @param {number} n */
const two = (n) => String(n).padStart(2, '0');

/** "01/Nov/2026:08:00:00 +0000" @param {Date} date */
function apacheTime(date) {
  return (
    `${two(date.getUTCDate())}/${MONTHS[date.getUTCMonth()]}/${date.getUTCFullYear()}:` +
    `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}:${two(date.getUTCSeconds())} +0000`
  );
}

/**
 * @param {{ seed?: number, normal?: number, inspected?: number, prevalence?: number }} [options]
 *   `normal` legitimate requests first, then `inspected` requests with `prevalence` attacks
 * @returns {{ text: string, labels: ('legit' | 'attack')[], baselineShare: number }}
 *   one label per line; `baselineShare` is the share of the log that is attack-free
 */
export function sampleLog({ seed = 42, normal = 4000, inspected = 1000, prevalence = 0.1 } = {}) {
  const { train, test } = buildDataset({
    seed,
    trainSize: normal,
    calibrationSize: 0,
    testSize: inspected,
    prevalence,
    hardShare: 0.05,
  });
  const rng = createRng((seed + 0x9e3779b9) >>> 0); // its own stream, apart from the dataset's
  const start = Date.UTC(2026, 10, 1, 8, 0, 0);
  /** @type {string[]} */
  const lines = [];
  /** @type {('legit' | 'attack')[]} */
  const labels = [];
  [...train, ...test].forEach((sample, i) => {
    const { method, path, params } = sample.request;
    const query = Object.entries(params)
      .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`)
      .join('&');
    const ip = `${rng.pick(NETWORKS)}.${rng.int(1, 254)}`;
    const status = sample.label === 'attack' ? rng.pick([200, 400, 403, 404, 500]) : 200;
    lines.push(
      `${ip} - - [${apacheTime(new Date(start + i * 1000))}] ` +
        `"${method} ${query ? `${path}?${query}` : path} HTTP/1.1" ${status} ${rng.int(200, 9000)} ` +
        `"-" "${rng.pick(AGENTS)}"`,
    );
    labels.push(sample.label);
  });
  return { text: `${lines.join('\n')}\n`, labels, baselineShare: normal / (normal + inspected) };
}
