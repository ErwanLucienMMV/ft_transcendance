# Privacy Policy and Terms of Service

The subject requires both pages, reachable from the application, with content that fits the
project; the project is rejected without them.

- Routes: `/privacy` and `/terms`, prerendered, linked from the footer of every page.
- Source: `srcs/angular/42chess/src/app/features/legal/`. The update date shown on both pages is
  `LEGAL_UPDATED` in `legal.ts`.
- Languages: each template holds the full text in English, French and Spanish, one `@case` per
  language (see [Languages](i18n.md)). A change must be made in all three, with the same
  sections in the same order.

## Acceptance

- The registration form has a required checkbox, "I accept the Terms of Service and the Privacy
  Policy", with both links opening in a new tab so the form keeps what was typed. The form is
  not sent until it is ticked.
- Under the Google, GitHub and 42 buttons of the sign-in page, a line says that creating an
  account with a provider means accepting both pages, with the same links.
- The acceptance is asked by the site's forms only: the API does not record it, so an account
  created by calling the API directly has not ticked anything.

## Keeping the Privacy Policy true

The policy lists what the backend really stores and who can read it. Update it, and
`LEGAL_UPDATED`, when one of these changes:

| Section | Source of truth |
|---|---|
| Data we collect | `users/user.entity.ts`, `auth/auth-session.entity.ts`, `oauth/oauth-accounts.entity.ts`, games, rating, puzzles, friends, presence and messages entities |
| Who can see it | public projections: `users/user-profile.ts` (`publicProfile`), `GET /v1/users/:id/games`, `GET /v1/users/:id/rating-history`, `GET /v1/games/live`, spectator mode; game chat history (`GET /v1/games/:id/messages`, any signed-in player); private messages (the two players only) |
| Cookies and browser storage | `auth/session-cookie.ts` (`refresh_token`), `REFRESH_EXPIRES_IN`, `core/preferences/preferences.ts` (localStorage, display and play preferences), `features/game/game-chat.ts` (localStorage, hide spectators) |
| How long we keep it | `EMAIL_VERIFICATION_TTL_MS`, `CHALLENGE_TTL_SECONDS`, `REFRESH_EXPIRES_IN` |

Settings let the player download a copy of their data and delete their account; deletion
erases the email, password, picture, friends, private and game chat messages and sign-in
methods, and keeps finished games under "Deleted player". If this changes, update the
"How long we keep it" and "Your rights" sections in the three languages.

## Tests

- `app.routes.spec.ts`: both routes, titles, the cross links and the update date.
- `app.spec.ts`: the footer links.
- `features/auth/auth-forms.spec.ts` and `e2e/auth.e2e.ts`: registration needs the checkbox.
- `e2e/navigation.e2e.ts`: opens both pages from the footer, then directly, with an empty console.
- `core/i18n/i18n.spec.ts` and `e2e/i18n.e2e.ts`: the French and Spanish versions.
