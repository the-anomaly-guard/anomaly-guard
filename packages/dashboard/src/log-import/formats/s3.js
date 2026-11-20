// AWS S3 server access logs: one line per request to a bucket, with the operation
// (REST.GET.OBJECT...) and the request line in quotes. Operations that S3 runs on its own
// (lifecycle, replication) have no request line.

import { SKIP, orNull, parseRequestLine, splitFields, statusOf } from '../format.js';

const FIELDS = [
  'bucket_owner',
  'bucket',
  'time',
  'remote_ip',
  'requester',
  'request_id',
  'operation',
  'key',
  'request_uri',
  'http_status',
  'error_code',
  'bytes_sent',
  'object_size',
  'total_time',
  'turn_around_time',
  'referer',
  'user_agent',
  'version_id',
  'host_id',
  'signature_version',
  'cipher_suite',
  'authentication_type',
  'host_header',
  'tls_version',
  'access_point_arn',
  'acl_required',
];

const OPERATION = /^[A-Z0-9_]+\.[A-Z0-9_.]+$/;

/** @type {import('../format.js').LogFormat} */
export default {
  id: 's3',
  label: 'AWS S3 server access',
  priority: 65,
  examples: [
    '79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be example-bucket [01/Nov/2026:09:20:01 +0000] 192.0.2.10 - 3E57427F3EXAMPLE WEBSITE.GET.OBJECT index.html "GET /index.html HTTP/1.1" 200 - 4096 4096 12 11 "-" "Mozilla/5.0 (X11; Linux x86_64)" - Ab12Cd34Ef56EXAMPLEHOSTID= - - - example-bucket.s3-website.eu-west-1.amazonaws.com - - -',
    '79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be example-bucket [01/Nov/2026:09:20:02 +0000] 198.51.100.7 - 3E57427F3EXAMPLF WEBSITE.GET.OBJECT ../../etc/passwd "GET /..%2F..%2Fetc%2Fpasswd HTTP/1.1" 403 AccessDenied 243 - 9 - "-" "scanner/1.0" - Ab12Cd34Ef56EXAMPLEHOSTIE= - - - example-bucket.s3-website.eu-west-1.amazonaws.com - - -',
  ],
  reader() {
    return (line) => {
      const tokens = splitFields(line);
      if (tokens.length < 10 || !tokens[2]?.bracketed || !OPERATION.test(tokens[6]?.value ?? '')) {
        return null;
      }
      /** @type {Record<string, string>} */
      const fields = {};
      tokens.forEach((token, i) => {
        fields[FIELDS[i] ?? `field_${i + 1}`] = token.value;
      });
      const parsed = tokens[8].quoted ? parseRequestLine(fields.request_uri) : null;
      if (!parsed) return SKIP;
      return {
        method: parsed.method,
        target: parsed.target,
        time: orNull(fields.time),
        status: statusOf(fields.http_status),
        fields,
      };
    };
  },
};
