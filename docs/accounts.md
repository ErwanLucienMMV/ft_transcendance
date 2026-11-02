# Account self-service

What a signed-in player can do with their own account, from the **Settings** page
(`/settings`, gear icon in the header) and the sign-in pages. API routes are given as
NestJS sees them (`/v1/...`); behind Nginx they start with `/api/v1`.

## Profile picture

| Route | Behavior |
| --- | --- |
| `POST /v1/users/me/avatar` | `multipart/form-data` with one `avatar` file. Returns the own profile. |
| `DELETE /v1/users/me/avatar` | Back to the default picture (the initial). Returns the own profile. |
| `GET /v1/avatars/:file` | Public. Serves a stored picture. |

- Accepted: PNG, JPEG or WebP, 2 MB at most. The type is read from the file's first
  bytes, never from its name or the browser's `Content-Type`; anything else (SVG, GIF,
  HTML renamed `.png`…) is refused with `400 INVALID_AVATAR`, a larger file with `413`.
- Files are written to `AVATAR_DIR` (default `uploads/avatars` under the API's working
  directory; the production compose file mounts the `avatars` volume there) under a
  random name `<user id>-<16 hex>.<ext>`. A new upload replaces the previous file, which
  is deleted.
- The database stores `avatars/<file>`. The front resolves it against `API_BASE_URL`.
  A picture taken from a sign-in provider at account creation is stored as its `https`
  URL and shown as is.
- Served files carry `Cache-Control: immutable` (the name changes with each upload),
  `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'`.
- `PATCH /v1/users/me` no longer accepts `avatarUrl`: a free URL would make every
  viewer's browser load an address chosen by another player.

Everywhere a player appears (header, profile, friends, search results, requests,
messages), the shared `app-avatar` component shows the picture, or the first letter of
the name on a colour derived from it when there is none or it fails to load.

## Two-factor authentication

| Route (bearer required) | Behavior |
| --- | --- |
| `GET /v1/auth/security` | `{ hasPassword, twoFactorEnabled, recoveryCodesLeft }` |
| `POST /v1/auth/2fa/setup` | New pending secret: `{ secret, otpauthUrl, qrSvg }` |
| `POST /v1/auth/2fa/enable` | `{ code }` from the app. Returns ten recovery codes, shown once |
| `POST /v1/auth/2fa/recovery-codes` | `{ code }`. Replaces every recovery code |
| `POST /v1/auth/2fa/disable` | `{ code }`. 204 |

- The secret stays pending (`twoFactorPendingSecret`) until a first valid code proves
  the app is set up; it then becomes the active secret.
- Recovery codes look like `abcde-12345` (no ambiguous characters). Only their SHA-256
  is stored. Each works once, at sign-in (`POST /v1/auth/2fa/verify` accepts either kind
  of code) or to turn 2FA off.
- Wrong codes count towards the same lock as sign-in (`TOO_MANY_2FA_ATTEMPTS`).
- Turning 2FA on or off sends a notice email.

## Passwords

| Route | Behavior |
| --- | --- |
| `POST /v1/auth/password` (bearer) | `{ currentPassword, newPassword }`. 204; other sessions are signed out |
| `POST /v1/auth/forgot-password` | `{ email }`. Always 202 |
| `POST /v1/auth/reset-password` | `{ token, password }`. 204; every session is signed out |

- The reset link (`/reset-password?token=…`) is valid for 30 minutes and works once.
  Only the token's hash is stored. Asking again replaces the previous link.
- `forgot-password` answers the same way whether or not the email belongs to an account,
  and does nothing for an account without a password (signed up through a provider).
- Every password change sends a notice email.

### Registration and existing emails

`POST /v1/auth/register` answers `409 EMAIL_ALREADY_EXISTS` when the email is taken. This
does tell a visitor that an address has an account. It is kept on purpose: the form
must say why the account was not created, the route is rate-limited, and usernames are
public anyway. The password reset, which an attacker could otherwise use to test
addresses, reveals nothing.

## Your data

| Route (bearer required) | Behavior |
| --- | --- |
| `GET /v1/users/me/export` | JSON download `42chess-<username>-<date>.json` |
| `DELETE /v1/users/me` | `{ confirmation, password?, code? }`. 204 |

- The export (`format: "42chess-account-export/1"`) holds the account, linked providers,
  sessions (without tokens), games with their moves, rating changes, friends, friend
  requests, private and game messages and puzzle attempts. A notice email is sent.
- Deletion needs the username typed again, the password if the account has one, and a
  code if 2FA is on. An account in a running game must finish it first
  (`409 ACTIVE_GAME_EXISTS`).
- The row is anonymized rather than removed, so that finished games stay readable for
  the opponents: the username becomes `deleted_<16 hex>` (a reserved prefix), email,
  password, secrets and picture are cleared, and `deletedAt` is set (a database check
  keeps those fields empty). Friendships, requests, private messages, game chat lines,
  puzzle attempts, provider links, waiting games and queue entries are deleted. Every
  session is revoked and the picture file removed. The front shows such players as
  "Deleted player". The name is free for a new account.

## Sign-in with 42

42 joins Google and GitHub (see [authentication.md](authentication.md)). Create an
application on the intra (Settings, API, *Register a new app*) with the redirect URI
`https://your-host:your-port/api/v1/auth/oauth/fortytwo/callback`, then set
`FORTYTWO_CLIENT_ID` and `FORTYTWO_CLIENT_SECRET` (and `FORTYTWO_CALLBACK_URL` if it
differs). `srcs/configure-oauth-local.sh 42` writes them to the local `.env`. The API
reads the login, email and picture from `GET https://api.intra.42.fr/v2/me`.

A new account created through any provider takes the provider's login as its username
when it is free and valid (otherwise with a number appended, or `<provider>_<hex>`),
and its picture. The sign-in then lands on `/settings?welcome=1`, where the player can
change both.

## Other changes

- Unverified accounts no longer appear in search results or public profiles (404).
- The session user (`user` in sign-in responses) now includes `avatarUrl`, so the header
  shows the picture without another request.
