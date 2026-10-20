# ELO rules

These rules follow `Proposition spec.md` §25–26. Each account starts at **1200**.
Ratings are controlled by the server; clients cannot modify them directly.

## Expected score and rating change

For a player rated `Ra` against an opponent rated `Rb`:

```text
expected = 1 / (1 + 10 ^ ((Rb - Ra) / 400))
delta = round(32 × (actualScore - expected))
ratingAfter = max(0, Ra + delta)
change = ratingAfter - Ra
```

The K-factor is fixed at **32**. The actual score is **1** for a victory,
**0.5** for a draw, and **0** for a defeat. The opponent receives the
complementary score. Both players' changes use their ratings before the game.

Round to the nearest integer, with exact halves away from zero: +0.5 becomes
+1 and -0.5 becomes -1. Changes of zero are represented as 0.

## Rating bounds

Ratings must be integers between **0** and **2,147,483,647**. Apply the zero
floor after rounding. Results above the maximum are rejected.

The reported `change` is the applied difference between `ratingAfter` and
`ratingBefore`. When the floor reduces a loss, the two players' changes may
not sum to zero. For extreme rating differences, the expected score may round
to 0 or 1; the calculated delta remains between -32 and +32.

## Examples

| Ratings before the game | Result            | Changes   | Ratings after the game |
| ----------------------- | ----------------- | --------- | ---------------------- |
| 1200 vs 1200            | First player wins | +16 / -16 | 1216 / 1184            |
| 1600 vs 1200            | First player wins | +3 / -3   | 1603 / 1197            |
| 1200 vs 1600            | First player wins | +29 / -29 | 1229 / 1571            |
| 1600 vs 1200            | Draw              | -13 / +13 | 1587 / 1213            |
| 0 vs 0                  | First player wins | +16 / 0   | 16 / 0                 |

## Rated-game eligibility

The agreed policy requires a standard starting position, two distinct user
participants, and a valid finished result. Checkmate, resignation, agreed draws,
valid draw claims, stalemate, insufficient material, and timeout all qualify.
Custom starting FENs are excluded.

Each eligible game updates both ratings, game statistics, and two history
entries atomically with its final result. Repeated completion requests cannot
award another rating change. Custom-position games change neither ratings nor
the statistics tracked by this rating policy.

## Transactions, concurrency and retries

`GameStoreService` applies rating changes inside the transaction that finishes
the game, including background clock expiry. It locks the game first and the
two account rows in UUID order. The rating service checks the stored result
and participants before calculating either change.

Both account updates and both history inserts must succeed together. A failure
rolls back the final game action as well. Each history row is unique by
`(userId, gameId)`. A retry validates the existing pair and returns
`ALREADY_APPLIED`; partial or inconsistent history is an error. Callers must
propagate failures rather than commit an incomplete rating update.

## Public rating history

```http
GET /api/v1/users/:id/rating-history?limit=20&offset=0
```

Nginx forwards this to Nest's `/v1/users/:id/rating-history` route. History is
public. The response is `{ "history": [...] }`; each entry contains `gameId`,
`ratingBefore`, `ratingAfter`, the applied `change`, and an ISO UTC `createdAt`.
Account emails, credentials, verification tokens and 2FA fields are excluded.

The default page has 20 entries. `limit` accepts integers from 1 to 100;
`offset` accepts nonnegative safe integers. Results are newest first, with
history UUID descending as the timestamp tie breaker. An existing account
without history returns an empty list. Malformed IDs or pagination return
400; an unknown user returns 404 with `USER_NOT_FOUND`.

## Validation

Run from `srcs/nestJS/42chess` with the dedicated test services available:

```sh
npm test -- src/rating/elo-calculation.spec.ts src/rating/elo-documentation.spec.ts
npm run test:db -- rating.integration-spec.ts rating-lifecycle.integration-spec.ts
npm run test:e2e -- rating-history.e2e-spec.ts
```

The calculation tests cover invalid inputs, boundaries, rounding, both players'
original ratings and all three scores. Database tests cover concurrent updates,
duplicate completion and rollback. The history endpoint tests verify privacy,
ordering, paging and errors. The documentation test checks every example above
against the calculation implementation.
