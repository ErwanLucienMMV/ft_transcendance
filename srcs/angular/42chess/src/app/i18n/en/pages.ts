/** The privacy policy and the terms; their long texts live in the page templates. */
export const legal = {
  updated: 'Last updated',
};

/** The living style guide. */
export const design = {
  title: 'How 42 Chess looks',
  intro:
    'Every colour, text style and reusable component of the site, drawn by the real code. Switch the theme to check both.',
  onThisPage: 'On this page',
  sections: {
    colours: 'Colours',
    type: 'Type',
    icons: 'Icons',
    actions: 'Buttons and fields',
    feedback: 'Feedback',
    navigation: 'Choices and pages',
    chess: 'Chess',
    players: 'Players',
  },
  coloursNote:
    "Tokens on <code>:root</code> in <code>styles.css</code>; the light theme redefines them under <code>[data-theme='light']</code>. Components use tokens only.",
  groups: {
    Surfaces: 'Surfaces',
    Text: 'Text',
    Accent: 'Accent',
    Feedback: 'Feedback',
  },
  typeSamples: {
    eyebrow: 'Eyebrow · section label',
    h1: 'Page title (h1), 28 px display',
    h2: 'Section title (h2), 17 px display',
    h3: 'Subsection title (h3)',
    body: 'Body text, 15 px. A game ends by checkmate, resignation, time or agreement.',
    muted: 'Muted text explains or adds detail.',
    small: 'Small text for dates and counts.',
    mono: 'monospace for moves, codes and tokens.',
  },
  iconsNote:
    '<code>&lt;app-icon name="…" /&gt;</code>: 24 px strokes in the text colour, hidden from screen readers, so a button keeps its words or an <code>aria-label</code>.',
  buttons: {
    primary: 'Primary',
    secondary: 'Secondary',
    ghost: 'Ghost',
    danger: 'Danger',
    small: 'Small',
    disabled: 'Disabled',
    link: 'A link as a button',
  },
  switch: 'A switch: an on/off setting',
  checkbox: 'A checkbox: an agreement in a form',
  alerts: 'Alerts',
  tones: {
    error: {
      heading: 'Error',
      text: 'An error message about this page.',
      name: 'error',
      toast: 'Your move was not sent. Try again.',
    },
    warning: {
      heading: 'Warning',
      text: 'A warning message about this page.',
      name: 'warning',
      toast: 'Your connection is unstable.',
    },
    success: {
      heading: 'Success',
      text: 'A success message about this page.',
      name: 'success',
      toast: 'Settings saved.',
    },
    info: {
      heading: 'Info',
      text: 'An info message about this page.',
      name: 'info',
      toast: '{{name}} is now online.',
    },
  },
  toasts: 'Toasts',
  toastsNote: 'News from elsewhere, top right. Errors go when the player changes page.',
  show: 'Show {{tone}}',
  empty: 'Empty and loading',
  badges: 'Badges',
  badgeTones: {
    neutral: 'neutral',
    accent: 'accent',
    success: 'success',
    warning: 'warning',
    danger: 'danger',
  },
  dialog: 'Dialog',
  removeFriend: 'Remove a friend…',
  answer: 'Answer: {{text}}',
  answers: {
    removed: 'removed',
    kept: 'kept',
  },
  shortRemoveText: 'Either of you can send a new request later.',
  speed: 'Speed',
  examplePages: 'Example pages',
  boardHelp: 'Drag or click to move, arrow keys to walk the squares, right-click to draw arrows.',
};
