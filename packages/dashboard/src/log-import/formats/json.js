// Generic JSON logs, one object per line: the fields are found by their usual names, nested or
// not. That covers, among others, Caddy (request.method, request.uri), Traefik (RequestMethod,
// RequestPath), AWS API Gateway (httpMethod, path; routeKey for HTTP APIs), AWS WAF
// (httpRequest.httpMethod, uri, args), Google Cloud load balancing (httpRequest.requestMethod,
// requestUrl), Cloudflare (ClientRequestMethod, ClientRequestURI), Azure (properties.httpMethod,
// requestUri), Elastic Common Schema (http.request.method, url.original) and Nginx with a JSON
// log_format. A name is looked for as the whole path first ("request.method"), then as its last
// parts ("properties.httpMethod" for "httpmethod"). Text before the object, as Docker Compose and
// Kubernetes write ("web  | {...}", "2026-11-01T09:00:00Z stdout F {...}"), is kept as a field.

import { SKIP, orNull, parseRequestLine, statusOf } from '../format.js';

const METHOD = /^[A-Z][A-Z-]{1,15}$/;
/** A path, "*", or an absolute URL. */
const TARGET = /^(?:\/|\*$|[a-z][a-z0-9+.-]*:\/\/)/i;

/** Candidate names, lowercase, nested ones with dots: the first that is present wins. */
const NAMES = {
  method: [
    'method',
    'http_method',
    'httpmethod',
    'request_method',
    'requestmethod',
    'verb',
    'cs-method',
    'request.method',
    'http.request.method',
    'httprequest.requestmethod',
    'req.method',
    'clientrequestmethod',
  ],
  target: [
    'request_uri',
    'requesturi',
    'uri',
    'url',
    'request.uri',
    'request.url',
    'url.original',
    'httprequest.requesturl',
    'req.url',
    'requestpath',
    'path',
    'request_path',
    'resourcepath',
    'url.path',
    'request.path',
    'cs-uri-stem',
    'clientrequesturi',
    'clientrequestpath',
  ],
  query: [
    'query',
    'querystring',
    'query_string',
    'args',
    'url.query',
    'request.query',
    'cs-uri-query',
    'requestquery',
    'clientrequestquery',
  ],
  requestLine: ['request', 'request_line', 'requestline', 'routekey'],
  status: [
    'status',
    'status_code',
    'statuscode',
    'response_status',
    'downstreamstatus',
    'response.status',
    'http.response.status_code',
    'httprequest.status',
    'res.statuscode',
    'sc-status',
    'response',
    'response_code',
    'http_status',
    'httpstatus',
    'httpstatuscode',
    'edgeresponsestatus',
  ],
  time: [
    'time',
    'timestamp',
    '@timestamp',
    'ts',
    'datetime',
    'date',
    'requesttime',
    'time_local',
    'time_iso8601',
    'starttime',
    'start_time',
    'edgestarttimestamp',
  ],
};

/**
 * Every leaf of an object as "a.b.c" -> text. A list of plain values is joined; a list of
 * objects (AWS WAF writes the headers so) is kept as JSON.
 * @param {unknown} value
 * @param {string} prefix
 * @param {Record<string, string>} out
 */
function flatten(value, prefix, out) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, inner] of Object.entries(value)) {
      flatten(inner, prefix ? `${prefix}.${key}` : key, out);
    }
  } else if (prefix) {
    const plain = (/** @type {unknown} */ item) => item === null || typeof item !== 'object';
    out[prefix] = !Array.isArray(value)
      ? String(value)
      : value.every(plain)
        ? value.join(', ')
        : JSON.stringify(value);
  }
  return out;
}

/** @type {import('../format.js').LogFormat} */
export default {
  id: 'json',
  label: 'JSON, one object per line (Caddy, Traefik, API Gateway, ECS...)',
  priority: 40,
  examples: [
    '{"ts":"2026-11-01T09:30:01Z","request":{"remote_ip":"192.0.2.10","method":"GET","host":"www.example.com","uri":"/search?q=blue+shoes","headers":{"User-Agent":["Mozilla/5.0"]}},"status":200}',
    '{"ClientHost":"198.51.100.7","RequestMethod":"GET","RequestPath":"/products?id=1%20UNION%20SELECT%20password%20FROM%20users","DownstreamStatus":200,"time":"2026-11-01T09:30:02Z"}',
    '{"requestId":"c6af9ac6-7b61-11e6-9a41-93e8deadbeef","ip":"203.0.113.5","requestTime":"01/Nov/2026:09:30:03 +0000","httpMethod":"POST","path":"/login","status":"401","protocol":"HTTP/1.1"}',
    '{"httpRequest":{"requestMethod":"GET","requestUrl":"https://www.example.com/profile?email=a%40example.com","status":200,"remoteIp":"192.0.2.55"},"timestamp":"2026-11-01T09:30:04Z"}',
  ],
  reader() {
    return (line) => {
      const brace = line.indexOf('{');
      if (brace === -1) return null;
      let object;
      try {
        object = JSON.parse(line.slice(brace));
      } catch {
        return null;
      }
      if (object === null || typeof object !== 'object' || Array.isArray(object)) return null;
      const fields = flatten(object, '', {});
      const prefix = line.slice(0, brace).trim();
      if (prefix) fields.prefix = prefix;
      /** @type {Record<string, string>} */
      const byName = {};
      /** @type {Record<string, string>} */
      const byEnd = {};
      for (const [key, value] of Object.entries(fields)) {
        const parts = key.toLowerCase().split('.');
        byName[parts.join('.')] ??= value;
        for (let i = 1; i < parts.length; i++) byEnd[parts.slice(i).join('.')] ??= value;
      }
      const found = (/** @type {Record<string, string>} */ map, /** @type {string[]} */ names) =>
        names.map((name) => orNull(map[name])).find((value) => value !== null) ?? null;
      const first = (/** @type {string[]} */ names) => found(byName, names) ?? found(byEnd, names);

      let method = first(NAMES.method);
      let target = first(NAMES.target);
      const line_ = first(NAMES.requestLine);
      const parsed = line_ ? parseRequestLine(line_) : null;
      if (parsed) {
        method ??= parsed.method;
        target ??= parsed.target;
      }
      // A JSON line without a request (a server message, a firewall record) is a line of the
      // format that holds none.
      if (!method || !METHOD.test(method.toUpperCase()) || !target || !TARGET.test(target)) {
        return SKIP;
      }
      const query = first(NAMES.query);
      if (query && !target.includes('?')) target = `${target}?${query.replace(/^\?/, '')}`;
      return {
        method: method.toUpperCase(),
        target,
        time: first(NAMES.time),
        status: statusOf(first(NAMES.status) ?? undefined),
        fields,
      };
    };
  },
};
