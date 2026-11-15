// About (about.html): the shared shell, and the team list built from src/team.js, so the names
// live in one place.

import { initShell } from '../shell.js';
import { h, mount } from '../dom.js';
import { TEAM, profileUrl } from '../team.js';

// Before initShell: the page is shown (data-ready) with the list already in it.
mount(
  '#team-list',
  TEAM.map((nickname) =>
    h(
      'li',
      {},
      h(
        'a',
        { href: profileUrl(nickname), target: '_blank', rel: 'noopener noreferrer' },
        `${nickname} ↗`,
      ),
    ),
  ),
);

initShell();
