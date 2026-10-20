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
