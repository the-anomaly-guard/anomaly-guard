// A logged request as the detector reads requests: method, path and parameter values (E-10,
// ADR-016). An adapter: the detector, the rules and the statistics stay as they are.
//
// - The query string is decoded once, as an application does (ADR-006), and a malformed escape is
//   kept as written rather than dropped.
// - The path is kept exactly as logged: no "/a/../b" -> "/b" clean-up, which would erase a path
//   traversal. Access logs record no request body, so the path, decoded, is also inspected as one
//   more value, the pseudo-parameter PATH_PARAM: the attacks of real traffic often sit there.
// - A query text without "=" names no parameter: "/shell?cd+/tmp;wget+..." is how real scans
//   send a command. It is a value too, of the pseudo-parameter QUERY_PARAM; as a parameter name it
//   would be seen by neither the rules nor the statistics, which inspect values.
// Pure: no DOM, tested in Node.

/** The name under which the decoded path is inspected like a parameter value. */
export const PATH_PARAM = '(path)';

/** The name under which a query text without "=" (no parameter name) is inspected. */
export const QUERY_PARAM = '(query)';

/**
 * One URL-decoding pass: %XX is a byte, and in a query string "+" is a space; a malformed escape
 * stays as written.
 * @param {string} text
 * @param {{ plusIsSpace?: boolean }} [options]  false for a path, where "+" is just a plus
 */
export function decodeOnce(text, { plusIsSpace = true } = {}) {
  const spaced = plusIsSpace ? text.replace(/\+/g, ' ') : text;
  try {
    return decodeURIComponent(spaced);
  } catch {
    // Decode the well-formed escapes one run at a time, keeping the rest.
    return spaced.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run;
      }
    });
  }
}

/**
 * Path and query of a request target: "/p?q", "https://host:443/p?q", "*" or "host:443".
 * @param {string} target
 * @returns {{ path: string, query: string, host: string | null }}
 */
export function splitTarget(target) {
  let rest = target;
  let host = null;
  const absolute = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(rest);
  if (absolute) {
    host = absolute[1];
    rest = rest.slice(absolute[0].length) || '/';
  }
  rest = rest.split('#')[0];
  const mark = rest.indexOf('?');
  return mark === -1
    ? { path: rest, query: '', host }
    : { path: rest.slice(0, mark), query: rest.slice(mark + 1), host };
}

/**
 * The query string as name -> value, each decoded once. A name seen again gets "#2", "#3"...
 * so no value is lost; a text without "=" is a value of QUERY_PARAM.
 * @param {string} query
 * @returns {Record<string, string>}
 */
export function parseQuery(query) {
  /** @type {Record<string, string>} */
  const params = {};
  if (!query) return params;
  for (const pair of query.split('&')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    const name = eq === -1 ? QUERY_PARAM : decodeOnce(pair.slice(0, eq));
    const value = decodeOnce(eq === -1 ? pair : pair.slice(eq + 1));
    let key = name;
    for (let n = 2; Object.hasOwn(params, key); n++) key = `${name}#${n}`;
    params[key] = value;
  }
  return params;
}

/**
 * The detector's view of a logged request.
 * @param {{ method: string, target: string }} entry
 * @returns {import('@anomaly-guard/core').AgRequest & { host: string | null }}
 */
export function toRequest(entry) {
  const { path, query, host } = splitTarget(entry.target);
  const params = parseQuery(query);
  const decodedPath = decodeOnce(path, { plusIsSpace: false });
  let key = PATH_PARAM;
  for (let n = 2; Object.hasOwn(params, key); n++) key = `${PATH_PARAM}#${n}`;
  params[key] = decodedPath;
  return { method: entry.method, path: path || '/', params, host };
}
