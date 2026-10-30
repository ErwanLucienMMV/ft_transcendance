# Privacy Policy and Terms of Service

The subject requires both pages, reachable from the application, with content that fits the
project; the project is rejected without them.

- Routes: `/privacy` and `/terms`, prerendered, linked from the footer of every page.
- Source: `srcs/angular/42chess/src/app/features/legal/`. The update date shown on both pages is
  `LEGAL_UPDATED` in `legal.ts`.

## Keeping the Privacy Policy true

The policy lists what the backend really stores and who can read it. Update it, and
`LEGAL_UPDATED`, when one of these changes:

| Section | Source of truth |
|---|---|
| Data we collect | `users/user.entity.ts`, `auth/auth-session.entity.ts`, `oauth/oauth-accounts.entity.ts`, games, rating, puzzles, friends and presence entities |
| Who can see it | public projections: `users/user-profile.ts` (`publicProfile`), `GET /v1/users/:id/games`, `GET /v1/users/:id/rating-history`, `GET /v1/games/live`, spectator mode |
| Cookies and browser storage | `auth/session-cookie.ts` (`refresh_token`), `REFRESH_EXPIRES_IN`, `features/puzzle/puzzles-api.ts` (sessionStorage) |
| How long we keep it | `EMAIL_VERIFICATION_TTL_MS`, `CHALLENGE_TTL_SECONDS`, `REFRESH_EXPIRES_IN` |

Account deletion is not available in the interface: the policy says the team handles it on
request. If a self-service deletion or a contact address is added, update both pages.

## Tests

- `app.routes.spec.ts`: both routes, titles, the cross links and the update date.
- `app.spec.ts`: the footer links.
- `e2e/navigation.e2e.ts`: opens both pages from the footer, then directly, with an empty console.
