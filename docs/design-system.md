# Design system

The look of 42 Chess comes from one set of tokens and a small library of reusable
components. The living guide is the `/design` page (linked in the footer): it draws every
token and component with the real code, in both themes.

## Tokens

All colours, fonts, radii and sizes are custom properties on `:root` in
`srcs/angular/42chess/src/styles.css`. Components and pages use the tokens only, never a
raw colour, so a theme is a second set of values.

| Group | Tokens |
| --- | --- |
| Surfaces | `--background`, `--surface`, `--surface-raised`, `--field`, `--field-hover`, `--header-background`, `--stripe` |
| Lines | `--border`, `--border-strong`, `--border-hover` |
| Text | `--text`, `--muted`, `--faint` |
| Accent | `--accent`, `--accent-hover`, `--accent-ink` (text on the accent), `--accent-soft`, `--accent-line` |
| Feedback | `--error` / `-bg` / `-border` / `-hover`, `--danger-ink`, `--success` / `-bg` / `-border`, `--warning` / `-bg` / `-border`, `--info-bg` / `-border` |
| Type | `--font-text`, `--font-display`, `--font-mono` |
| Shape | `--radius-sm`, `--radius`, `--radius-lg`, `--shadow` |
| Layout | `--page-width`, `--gutter`, `--header-height` |

Headings: one `h1` per page (28 px display font, larger in a page header), `h2` for
sections (17 px), `h3` for subsections. The shell has no heading of its own.

## Themes

Dark is the default palette; `:root[data-theme='light']` redefines the tokens. The player
picks Light, Dark or System (follows `prefers-color-scheme`) in the footer, in Settings or
on `/design`. The choice is stored in the browser (`42chess.preferences`) and, when signed
in, in the account (`preferences.theme` of `PATCH /users/me`), so it follows the player.
`public/theme.js` applies it before the first paint (an external script, as the CSP forbids
inline ones) and `Preferences` keeps `data-theme` and `<meta name="theme-color">` in step.

## Global classes

`styles.css` styles plain elements and a few classes shared by every page: buttons
(`button`, `.button`, with `.secondary`, `.ghost`, `.danger`, `.small`), fields
(`.form-field` with its label, help and error), `.switch` (a checkbox drawn as a switch),
`.card`, `.rows` (a list of rows), `.page`, `.page-head`, `.eyebrow`, `.muted` and `.sr-only`.

## Components

Under `src/app/shared/ui/` unless noted. Each is standalone; import it where used.

| Component | Use | Main inputs and outputs |
| --- | --- | --- |
| `<app-icon>` | 24 px stroke icons in the text colour, hidden from screen readers (the button keeps its words or an `aria-label`) | `name` (`IconName`: alert, info, check, close, chevrons, first, last, play, pause, flip, rematch, download, copy, board, message, sun, moon, system, volume, mute, settings) |
| `<app-alert>` | A message about the page. Errors and warnings use `role="alert"`, success and info `role="status"` | `tone` (`error`, `warning`, `success`, `info`), `heading`, `dismissible`, `(dismissed)`; content projected |
| `Toasts` + `<app-toasts>` | News that is not about the page in view: API failures, saved settings. Top right, at most four, one per `key`; errors stay 8 s and go when the page changes | `show(text, { tone, key, duration, link })`, `error()`, `success()`, `dismiss(id)`, `clear(tone?)` |
| `<app-empty-state>` | Nothing to show yet, or loading: a faint piece, a line, what to do next | `piece`, `heading`, `loading` (adds `role="status"`); content projected |
| `<app-spinner>` | Something is loading, with a spoken label | `label`, `showLabel` |
| `<app-badge>` | A short count or state, e.g. unread messages in the header | `tone` (`neutral`, `accent`, `success`, `warning`, `danger`) |
| `<app-segmented>` | One choice among a few, side by side: a radio group with arrow keys, Home and End | `options` (`{ value, label, icon? }`), `label`, `[(value)]` |
| `<app-pager>` | Previous and next page of a long list, hidden for one page | `page`, `pages`, `label`, `(pageChange)` |
| `<app-confirm-dialog>` | Asks before an action that cannot be undone: a modal `<dialog>`, Escape cancels, focus returns | `heading`, `confirmLabel`, `cancelLabel`, `tone` (`danger`), `open()`, `(confirmed)`, `(cancelled)` |
| `<app-chess-board>` (`shared/chess/`) | The board: click, drag, keyboard, premoves, arrows, last-move slide. See [chessboard.md](chessboard.md) | `fen`, `orientation`, `lastMove`, `interactive`, `playerColor`, `premoves`, `annotations`, `(moved)` |
| `<app-move-list>` (`shared/chess/`) | The moves of a game in numbered rows; buttons in a replay | `rows`, `current`, `navigable`, `(selected)` |
| `<app-captured-pieces>` (`shared/chess/`) | Pieces a side has taken and its material lead | `fen`, `color` |
| `<app-avatar>` (`shared/`) | A player's picture, or their initial when there is none or it fails | `username`, `url` |
| `<app-presence-badge>` (`shared/`) | Online, in a game or offline | `status` |
| `<app-level-bar>` (`shared/`) | Level and XP towards the next one | `progress` |
| `<app-elo-chart>` (`shared/`) | Elo over time on a profile | `history` |

## Rules of thumb

- One `h1` per page, then `h2` and `h3` in order.
- Say what happened and what to do next; an error is never a bare code.
- Every control is reachable by keyboard and has a visible focus ring
  (`:focus-visible` uses the accent).
- Motion respects `prefers-reduced-motion`.
- A new colour is a new token in both palettes, never a literal in a component.
- A new reusable piece goes in `shared/ui/`, gets a case in `ui.spec.ts` and a section on
  `/design`.
- No text is written in a template or a component: every visible word, label and
  `aria-label` comes from the dictionaries, in the three languages (see [Languages](i18n.md)).
  Dates use the `localDate` pipe.
- A checkbox with its text, for an agreement, uses `.checkbox`; an on/off setting uses
  `.switch`.
