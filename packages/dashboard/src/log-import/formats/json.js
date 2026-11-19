// Generic JSON logs, one object per line: the fields are found by their usual names, nested or
// not. That covers, among others, Caddy (request.method, request.uri), Traefik (RequestMethod,
// RequestPath), AWS API Gateway (httpMethod, path), Google Cloud load balancing
// (httpRequest.requestMethod, requestUrl), Elastic Common Schema (http.request.method,
// url.original) and Nginx with a JSON log_format.

import { orNull, parseRequestLine, statusOf } from '../format.js';

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
  ],
  query: [
    'query',
    'querystring',
    'query_string',
    'args',
    'url.query',
    'request.query',
    'cs-uri-query',
  ],
  requestLine: ['request', 'request_line', 'requestline'],
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
  ],
};

/**
 * Every leaf of an object as "a.b.c" -> text, and a lookup by lowercase name.
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
    out[prefix] = Array.isArray(value) ? value.join(', ') : String(value);
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
      const text = line.trim();
      if (!text.startsWith('{')) return null;
      let object;
      try {
        object = JSON.parse(text);
      } catch {
        return null;
      }
      const fields = flatten(object, '', {});
      /** @type {Record<string, string>} */
      const byName = {};
      for (const [key, value] of Object.entries(fields)) byName[key.toLowerCase()] ??= value;
      const first = (/** @type {string[]} */ names) =>
        names
          .map((name) => orNull(byName[name]))
          .find((value) => value !== null && value !== undefined) ?? null;

      let method = first(NAMES.method);
      let target = first(NAMES.target);
      const line_ = first(NAMES.requestLine);
      const parsed = line_ ? parseRequestLine(line_) : null;
      if (parsed) {
        method ??= parsed.method;
        target ??= parsed.target;
      }
      if (!method || !target) return null;
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
