# SCRUM-488 · Server-owned Elo verification

Reviewed 2 November 2026 against `dev_test` at `062aaa6`.

Elo is already server-controlled. Profile and preference DTOs do not accept
rating fields; the global pipe rejects extra fields before persistence. Existing
HTTP tests reject top-level Elo and protected account properties atomically.
Rating lifecycle integration verifies durable server-side game settlement.

This branch adds three HTTP regression cases mixing valid preferences with
nested Elo, null Elo or an object-shaped rating assignment. Each is rejected
with VALIDATION_ERROR. Full owner and unrelated-user rows remain unchanged,
proving no partial application of the valid editable fields.

Validation: backend build passed; profile update and preference acceptance
suites passed **24 tests in two files** using real JWT sessions and the isolated
test database. The baseline database suite passed **408 tests in 28 files**,
including rating lifecycle, on identical production source. Vite retains its
existing path-plugin notice. No production rating data or user was touched.

Reproduce from `srcs/nestJS/42chess` with dedicated test fixtures running:

```sh
npm run build
./node_modules/.bin/vitest run --config vitest.config.e2e.ts test/users-update.e2e-spec.ts test/users-preferences.e2e-spec.ts
./node_modules/.bin/vitest run --config vitest.config.database.ts test/rating-lifecycle.integration-spec.ts
```

Sources: [profile DTO](../srcs/nestJS/42chess/src/users/dto/update-profile.dto.ts),
[profile tests](../srcs/nestJS/42chess/test/users-update.e2e-spec.ts),
[rating lifecycle](../srcs/nestJS/42chess/test/rating-lifecycle.integration-spec.ts).
