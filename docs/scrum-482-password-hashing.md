# SCRUM-482 · Password hashing verification

Reviewed 2 November 2026 against `dev_test` at `062aaa6`.

PasswordService already hashes with salted Argon2id and fails closed on an
invalid stored hash. Existing tests cover algorithm selection, a different salt
for the same password, valid/invalid password verification and malformed hashes.

Two additional regression cases verify that Unicode passwords are not silently
normalized/truncated and that embedded null bytes do not discard a private
suffix. The exact password verifies; normalized/truncated/different suffixes do
not. These checks protect the byte-preserving credential boundary without
changing valid registration rules or the hash format.

Validation: `npm test -- src/auth/password.service.spec.ts` passed **6 tests**.
The complete baseline backend acceptance run also passed **362 tests in 41
files**, including auth and sessions, on identical production source. The
existing Vite path-plugin notice remains. No credentials were read, rotated or
logged, and no production password data was used.

Sources: [PasswordService](../srcs/nestJS/42chess/src/auth/password.service.ts),
[tests](../srcs/nestJS/42chess/src/auth/password.service.spec.ts).
