# Friend requests

Jira: FRONT-SOCIAL-04 to 07 (SCRUM-338 to 341) and FTEST-04 (SCRUM-458).
Needs the friends management API of PR #67 (which contains PR #64); this lot merges that
branch, so its PR goes after them.

## What the user can do

| Where | Action | API |
|---|---|---|
| A player's profile | **Add friend**, then "Friend request sent." | `POST /v1/friends/requests` `{ recipientId }` |
| `/friends`, "Friend requests" | see who asked (name and Elo), **Accept** or **Decline** | `GET /v1/friends/requests`, `POST …/:id/accept`, `POST …/:id/reject` |
| `/friends`, "Your friends" | **Remove**, then **Confirm removal** | `DELETE /v1/friends/:friendId` |

A profile already in the visitor's friend list says "You are friends." instead of the button.
Refusals become sentences: `FRIEND_REQUEST_PENDING` ("a request between you is already
pending", with a link to the requests), `ALREADY_FRIENDS`, a request resolved elsewhere
(`FRIEND_REQUEST_FINALIZED` or `_NOT_FOUND`) is dropped from the list, and a friendship removed
elsewhere reloads the list.

## Differences from the spec, to settle with the backend

- Spec §5 says `GET /friends/requests` returns `{ incoming, outgoing }`. PR #67 returns
  `{ requests }`, incoming only. Without the outgoing list, a profile cannot show "request
  sent" after a reload; pressing the button again gets a 409, which Chrome logs in the console.
- Spec §5 rejects with `DELETE /friends/requests/:id` (which also cancels a sent request);
  PR #67 uses `POST …/reject` and has no cancel.
- The request DTO has ids only, so the page reads each sender's public profile
  (`GET /v1/users/:id`). Adding the sender's username and Elo to the DTO would save those calls.
- No WebSocket event announces a new request, so the page reads the inbox again every 30 s
  (`REQUESTS_REFRESH_MS`).

## Tests

- Unit: `users-api.spec.ts` (routes and bodies), `friends-page.spec.ts` (inbox with a missing
  sender profile, accept then reload, decline, a request resolved elsewhere, removal only after
  confirmation), `profile-page.spec.ts` (button only for another signed-in user, friend
  detection, sent and pending answers).
- Browser: `e2e/friends.e2e.ts` covers request, duplicate, accept, presence pushed to the
  friend list when the friend signs out, and removal.
