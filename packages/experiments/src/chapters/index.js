// The report's chapters with generated numbers (D-08, ADR-014): each name is a template pair in
// docs/report/templates/ (<name>.en.md, <name>.it.md), and its function turns the saved numbers
// (docs/report/numbers.json) into the chapter's facts and claims. To add a chapter, write its
// templates and its function, and list it here.

import { t3Facts } from './t3.js';

export const CHAPTERS = Object.freeze({
  't3-evaluation-and-uncertainty': t3Facts,
});
