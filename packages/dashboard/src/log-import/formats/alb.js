// AWS load balancers: the access logs of an Application Load Balancer (the first field is the
// connection type) and of a Classic Load Balancer (it starts with the time). Both log the request
// with its absolute URL: "GET https://www.example.com:443/path?query HTTP/1.1".

import { SKIP, orNull, parseRequestLine, splitFields, statusOf } from '../format.js';

const ALB_FIELDS = [
  'type',
  'time',
  'elb',
  'client',
  'target',
  'request_processing_time',
  'target_processing_time',
  'response_processing_time',
  'elb_status_code',
  'target_status_code',
  'received_bytes',
  'sent_bytes',
  'request',
  'user_agent',
  'ssl_cipher',
  'ssl_protocol',
  'target_group_arn',
  'trace_id',
  'domain_name',
  'chosen_cert_arn',
  'matched_rule_priority',
  'request_creation_time',
  'actions_executed',
  'redirect_url',
  'error_reason',
  'target_port_list',
  'target_status_code_list',
  'classification',
  'classification_reason',
  'conn_trace_id',
];

const CLASSIC_FIELDS = [
  'time',
  'elb',
  'client',
  'backend',
  'request_processing_time',
  'backend_processing_time',
  'response_processing_time',
  'elb_status_code',
  'backend_status_code',
  'received_bytes',
  'sent_bytes',
  'request',
  'user_agent',
  'ssl_cipher',
  'ssl_protocol',
];

const TYPES = new Set(['http', 'https', 'h2', 'grpcs', 'ws', 'wss']);
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** @type {import('../format.js').LogFormat} */
export default {
  id: 'alb',
  label: 'AWS load balancer (ALB, Classic ELB)',
  priority: 60,
  examples: [
    'https 2026-11-01T09:00:01.123456Z app/web-alb/50dc6c495c0c9188 192.0.2.10:52734 10.0.1.12:80 0.001 0.024 0.000 200 200 312 4096 "GET https://www.example.com:443/search?q=blue+shoes HTTP/1.1" "Mozilla/5.0 (X11; Linux x86_64)" ECDHE-RSA-AES128-GCM-SHA256 TLSv1.2 arn:aws:elasticloadbalancing:eu-west-1:123456789012:targetgroup/web/73e2d6bc24d8a067 "Root=1-6720f2b1-0123456789abcdef01234567" "www.example.com" "arn:aws:acm:eu-west-1:123456789012:certificate/12345678-1234-1234-1234-123456789012" 0 2026-11-01T09:00:01.098000Z "forward" "-" "-" "10.0.1.12:80" "200" "-" "-" TID_0123456789abcdef',
    'http 2026-11-01T09:00:02.000000Z app/web-alb/50dc6c495c0c9188 198.51.100.7:40122 10.0.1.12:80 0.000 0.010 0.000 404 404 220 512 "GET http://www.example.com:80/cgi-bin/test.cgi?cmd=%3Bcat%20%2Fetc%2Fpasswd HTTP/1.1" "scanner/1.0" - - arn:aws:elasticloadbalancing:eu-west-1:123456789012:targetgroup/web/73e2d6bc24d8a067 "Root=1-6720f2b2-0123456789abcdef01234567" "-" "-" 0 2026-11-01T09:00:01.990000Z "forward" "-" "-" "10.0.1.12:80" "404" "-" "-" TID_0123456789abcdef',
    '2026-11-01T09:00:03.456789Z classic-web 203.0.113.5:61234 10.0.2.20:80 0.000043 0.001337 0.000057 200 200 0 29 "GET http://www.example.com:80/products?id=42 HTTP/1.1" "curl/8.4.0" - -',
  ],
  reader() {
    return (line) => {
      const tokens = splitFields(line);
      const values = tokens.map((t) => t.value);
      let names;
      if (TYPES.has(values[0]) && ISO_TIME.test(values[1] ?? '')) names = ALB_FIELDS;
      else if (ISO_TIME.test(values[0] ?? '') && tokens[11]?.quoted) names = CLASSIC_FIELDS;
      else return null;
      const requestIndex = names.indexOf('request');
      if (!tokens[requestIndex]?.quoted) return null;
      /** @type {Record<string, string>} */
      const fields = {};
      values.forEach((value, i) => {
        fields[names[i] ?? `field_${i + 1}`] = value;
      });
      const parsed = parseRequestLine(fields.request);
      if (!parsed) return SKIP; // a TCP listener logs "- - - "
      return {
        method: parsed.method,
        target: parsed.target,
        time: orNull(fields.time),
        status: statusOf(fields.elb_status_code),
        fields,
      };
    };
  },
};
