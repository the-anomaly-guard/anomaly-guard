# ADR-016: Import logs - real server logs, analysed in the browser

**Date:** 2026-11-19
**Status:** Accepted
**Author:** Nicholas Arcari (task E-10)

## Context

- ADR-001 and AGENTS.md §2 keep the project on synthetic traffic: the generator gives known
  labels, nothing real is touched, and every result can be reproduced from a seed.
- The group asked for a way to point the same detector at real traffic: the access log of an
  Apache, Nginx or AWS server, or any other log of HTTP requests, loaded from the console.
- A real log has no labels, holds personal data (client addresses, user agents, sometimes user
  names in the URL) and may hold real attack payloads. The console has no backend: it runs on
  GitHub Pages (ADR-003).

## Decision

1. **A new page, Import logs (`logs.html`).** The user pastes lines or picks files (also several,
   and .gz as AWS delivers them). Everything happens in the browser: the file is never uploaded
   (the CSP has `connect-src 'self'`), never saved (no storage), and the page forgets it when it
   is closed. A notice on the page says so.
2. **Every field of the log is kept and shown**, client address and user agent included, as the
   owner of the feature chose: the page is a tool for whoever already holds the log. Nothing goes
   into the repository: the tests and the examples use synthetic lines only (documentation
   addresses of RFC 5737, `example.com`).
3. **Formats are plug-ins.** Each format is one file in `packages/dashboard/src/log-import/formats/`,
   with the same contract (`LogFormat`: an id, a label, a priority, synthetic examples and a line
   reader). The page finds them with `import.meta.glob` and the tests by listing the folder, so a
   new format is a new file and nothing else changes; the engine (`read.js`) receives the list and
   knows no format. First formats: Apache and Nginx (common, combined, vhost_combined, also behind
   a proxy that logs a list of clients), AWS load balancers (ALB, Classic ELB), W3C extended
   (CloudFront, IIS, also lines copied without their `#Fields` header), AWS S3 server access, JSON
   lines (Caddy, Traefik, AWS API Gateway and WAF, Google Cloud, Cloudflare, Azure, ECS, also after
   a Docker or Kubernetes prefix) and, last, any line with an HTTP request line (HAProxy, a line
   that Docker wrapped in JSON...).
   The format is recognised on the first 200 lines: the one that reads the largest share wins, a
   specific one over a generic one on a tie; it can also be chosen by hand.
4. **The detector is reused as it is.** A logged request becomes the detector's input
   (`request.js`): the query string decoded once (ADR-006), the path kept exactly as logged (no
   `/a/../b` clean-up, which would erase a traversal). Access logs record no body, so the decoded
   path is also inspected as one more value, the pseudo-parameter `(path)`: real attacks often sit
   in the path, which the rules and the statistics would otherwise never see. A query text
   without `=` names no parameter: it is inspected as the value of the pseudo-parameter `(query)`.
   Real scans send commands that way (`/shell?cd+/tmp;wget+...`): as a parameter name the payload
   would reach neither the rules nor the statistics, which inspect values.
5. **What counts as normal is an explicit assumption.** With no labels, the statistics learn from
   a baseline the user trusts: a separate log, or the first 25, 50 or 75% of the same one. Its
   first 70% trains the model (ADR-004); its last 30% sets the threshold at the chosen target FPR
   (ADR-009, `operatingPoint`), with a warning below `n ≥ 10/α`. The rest of the log is scored
   once. The rules learn nothing, so in rules-only mode the whole log is inspected.
6. **No error rates.** Without labels the page reports alerts, signatures, statistical alerts and
   the calibration FPR, never a TPR or a test FPR. A seeded sample log written from the simulated
   traffic (`sample.js`) lets anyone try the page, and gives the tests a log whose answers are
   known.

## Alternatives considered

| Alternative                                   | Why not                                                                                            |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Upload to a server and analyse there          | No backend on GitHub Pages (ADR-003), and the log would leave the user's machine                   |
| Score with the model of the simulated traffic | Its (path, parameter) pairs are those of the simulator: a real site's requests would all be unseen |
| Train on the whole log                        | The attacks in it would become "normal"; the baseline is an explicit, visible assumption instead   |
| Drop client addresses and user agents         | The owner of the feature chose to see every field; nothing is stored or sent either way            |
| One parser with a switch per format           | Every new format would modify it; one file per format keeps the engine closed to change            |
| Normalise the path with the URL API           | `new URL` removes `..` segments, which would hide path traversal                                   |

## Consequences

### Positive

- The same rules and statistics can be tried on real traffic, with nothing new in `core`.
- A new log format is one file and its examples; the contract test checks it automatically.

### Negative / risks

- Real personal data appears on screen; the page warns, and nothing is stored or sent.
- The baseline is an assumption: an attack inside it lowers the model's guard, and the warning
  on the rules (they fire on the baseline) is the only hint.
- POST bodies are not in access logs: attacks in a body are invisible here. Parameter names are
  not inspected either: a payload written as a name with a value (`?<script>=1`) is not seen. A
  request line that is not one (a TLS handshake sent to the HTTP port) is counted as a line
  without a request.
- Large logs: the page keeps the first 100 MB of text of a log, read as a stream (a gzip file
  expands about ten times: a real 20 MB .gz held 205 MB of text and took the tab to 721 MB), and
  analyses up to 100,000 requests; it says when it cut. Scoring runs in slices to keep the page
  responsive, but training and calibration block it for a moment.
- Files as they come: a gzip file of several members (Nginx writes one per buffer, `cat a.gz b.gz`
  joins two) is read whole, member by member, since the browser's decompressor stops after the
  first; a file cut short keeps the lines before the damage, and the page says so; UTF-16 files
  with a byte order mark (Windows tools) are read too.

### Actions

- [x] `logs.html`, `src/pages/logs.js`, `src/logs.css`, `src/log-import/` (engine, request adapter,
      analysis, files, sample, six formats), tests on synthetic lines.
- [ ] More formats when needed: one file each in `src/log-import/formats/`.
