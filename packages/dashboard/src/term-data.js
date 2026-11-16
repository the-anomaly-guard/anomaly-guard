// The dictionary of terms for the browser (terms.js): the ruleset the detector uses, and the ADRs
// of their index, read when the dashboard is built (vite.config.js, `virtual:term-sources`). Only
// the short explanations reach the page, not the documents.

import docs from 'virtual:term-sources';
import { DEFAULT_RULES } from '@anomaly-guard/core';
import { buildTerms } from './terms.js';

export const TERMS = buildTerms({ rules: DEFAULT_RULES, docs });
