/** The public service status page. */
export const status = {
  eyebrow: 'Service status',
  title: 'Is 42 Chess working?',
  intro:
    'What the server reaches right now. This page refreshes itself every {{seconds}} seconds while it is open.',
  checking: 'Checking the services…',
  services: 'Services',
  unknown: 'Unknown',
  operational: 'Operational',
  down: 'Down',
  backups: 'Database backups',
  backupNote: 'A backup runs every hour and the last 24 hours are kept.',
  checkedAt: 'Checked at {{time}}',
  checkingShort: 'Checking…',
  again: 'Check again',
  list: {
    api: {
      name: 'Website and API',
      role: 'Pages, sign-in and live games',
    },
    database: {
      name: 'Database',
      role: 'Accounts, games, puzzles and messages',
    },
    'chess-engine': {
      name: 'Rules engine',
      role: 'Checks every move of every game',
    },
    bot: {
      name: 'Computer opponent',
      role: 'Games against the computer',
    },
    mail: {
      name: 'Email',
      role: 'Verification and password emails',
    },
  },
  unreachable: {
    title: '42 Chess is unreachable',
    text: 'The server does not answer: games, sign-in and puzzles are unavailable.',
  },
  outage: {
    title: 'Major outage',
    text: 'The database is unreachable: nothing that needs an account works.',
  },
  degraded: {
    title: 'Some services are down',
    text: 'The site works, except what depends on the services marked below.',
  },
  ok: {
    title: 'All systems operational',
    text: 'Everything works normally.',
  },
  noBackup: 'No backup has been recorded yet.',
  lastBackup: 'Last backup {{ago}}.',
  lateBackup: 'Late: the last backup was {{ago}}.',
  ago: {
    now: 'less than a minute ago',
    day: {
      one: '{{count}} day ago',
      other: '{{count}} days ago',
    },
    hour: {
      one: '{{count}} hour ago',
      other: '{{count}} hours ago',
    },
    minute: {
      one: '{{count}} minute ago',
      other: '{{count}} minutes ago',
    },
  },
};
