# Development fixtures (SCRUM-67..70 / DB-22..25)

Apply migrations first against your **development database**, then run from
`srcs/nestJS/42chess`:

```sh
npm run migration:run
# Set DEV_SEED_PASSWORD locally without committing it or putting it in shell history.
read -rs -p 'Development password (12+ characters): ' DEV_SEED_PASSWORD
export DEV_SEED_PASSWORD
NODE_ENV=development ALLOW_DEV_SEED=yes npm run seed:dev
unset DEV_SEED_PASSWORD
```

The command uses the existing `DATABASE_*` connection configuration. Confirm it
points to development before opting in. It never runs automatically on startup
or during migrations. Both opt-in variables and a 12-character password are
required. The environment guard is an operator safeguard, not proof that the
configured database is disposable.

Fixtures:

- DB-23: verified local accounts `dev_alice@example.test` / `dev_bob@example.test`,
  usernames `dev_alice` / `dev_bob`, both using the supplied password hashed with
  Argon2. Do not use real credentials. Two-factor authentication is off.
- DB-24: one waiting game with Alice, one finished game where Bob resigned before
  making a move. Both use five minutes plus two seconds per move. Finished games
  legitimately have no live clock or move history in this example.
- DB-25: two mate-in-one positions, one for each color, using UCI solutions.
- DB-22: the single transaction assembles all fixtures and serializes concurrent
  seed runs with a PostgreSQL advisory lock.

Fixed UUIDs make reruns insert-only and idempotent. Existing passwords and rows
are never updated or deleted; changing the supplied password does not reset an
existing fixture account. A conflicting username/email aborts the transaction.
The seed does not recalculate user statistics or create a daily puzzle assignment.
It contains no cleanup/reset command. Review any fixture removal separately.

Validation: `npm test` tests the guard; `npm run test:db` verifies reruns, password
hashes, rollback on collisions, and puzzle solutions against the real chess engine
in a random disposable PostgreSQL schema.
