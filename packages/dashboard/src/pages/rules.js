// Rules: the signature engine and how often each rule fired on the current test split, split by
// the simulator's ground truth. The ruleset itself is task B-01. The counts grow as the live
// replay brings the test requests in (E-08, ADR-011).

import { initShell } from '../shell.js';
import { runExperiment } from '../pipeline.js';
import { h, mount, fmt } from '../dom.js';
import { kpi } from '../ui.js';
import { initLive } from '../live.js';

const state = initShell();
const run = runExperiment(state);
const { events, ruleEngine } = run;
const evaluated = state.mode !== 'stats';
const families = new Set(ruleEngine.rules.map((rule) => rule.kind));

if (!evaluated) {
  mount(
    '#mode-note',
    h(
      'div',
      { class: 'callout is-warning' },
      'Statistics-only mode: the rules are not evaluated, so every count below is zero. ' +
        'Choose "Rules + statistics" or "Rules only" in the settings bar.',
    ),
  );
}

initLive({ state, run, render });

/** @param {import('../replay.js').Frame} frame */
function render(frame) {
  const view = events.slice(0, frame.at);

  /** Requests matched per rule (a request counts once per rule), by ground truth. */
  const matches = new Map(
    ruleEngine.rules.map((rule) => [rule.id, { all: 0, attack: 0, legit: 0 }]),
  );
  for (const e of view) {
    for (const id of new Set(e.result.detail.hits.map((hit) => hit.ruleId))) {
      const m = matches.get(id);
      if (!m) continue;
      m.all++;
      m[e.attack ? 'attack' : 'legit']++;
    }
  }
  const matched = view.filter((e) => e.result.ruleMatched);
  const onLegit = matched.filter((e) => !e.attack).length;

  mount(
    '#kpis',
    kpi('Rules', ruleEngine.rules.length),
    kpi(`Attack families covered (${[...families].join(', ')})`, families.size),
    kpi('Requests matched', evaluated ? matched.length : '-', 'primary'),
    kpi(
      'Matches on legitimate requests',
      evaluated ? onLegit : '-',
      onLegit ? 'danger' : 'success',
    ),
  );

  mount(
    '#rules-body',
    ruleEngine.rules.map((rule) => {
      const m = matches.get(rule.id) ?? { all: 0, attack: 0, legit: 0 };
      return h(
        'tr',
        {},
        h('td', { class: 'mono nowrap' }, rule.id),
        h('td', {}, rule.kind),
        h(
          'td',
          { class: 'mono pattern', 'data-raw': true },
          `/${rule.pattern.source}/${rule.pattern.flags}`,
        ),
        h('td', { class: 'num' }, fmt.int(m.all)),
        h('td', { class: 'num' }, fmt.int(m.attack)),
        h('td', { class: m.legit ? 'num is-bad' : 'num' }, fmt.int(m.legit)),
      );
    }),
  );

  let meta = 'requests matched on the current test split';
  if (frame.stage === 'idle') meta = 'no traffic yet · the counts start at zero';
  else if (frame.stage !== 'done') {
    meta = `requests matched so far · ${fmt.int(view.length)} of ${fmt.int(frame.total)} arrived`;
  }
  mount('#ruleset-meta', meta);
}
