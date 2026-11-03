# SCRUM-483 · DTO boundary verification

Reviewed 2 November 2026 against `dev_test` at `062aaa6`.

The global validation pipe already transforms documented DTOs and rejects
unknown fields. This branch reuses the input audit from existing commit
`c580ebc`, preserving that commit and its original branch, and extends it to
the current square-based puzzle move DTO.

The matrix covers all 17 exported request DTO classes, including the two DTOs
in the bot controller and pagination. For each, it accepts documented input,
rejects invalid fields/types/bounds, and rejects server-owned userId, senderId,
elo, passwordHash and emailVerifiedAt. Nested time-control and preference
injection is rejected. Bot UCI strings additionally pass through the domain
parser, which rejects malformed, null, non-string and injection-shaped values.
OAuth callbacks validate provider/state/code manually rather than as DTO input.

Validation: `npm test -- src/common/dto-security.spec.ts` passed **131 cases**.
No production validation behavior or public interface changed. The existing
Vite path-plugin notice remains. The baseline acceptance and database suites
also passed on the same production source (362 and 408 tests respectively).

Sources: [global pipe](../srcs/nestJS/42chess/src/common/validation.ts),
[input matrix](../srcs/nestJS/42chess/src/common/dto-security.spec.ts),
[square move DTO](../srcs/nestJS/42chess/src/puzzles/dto/puzzle-square-move.dto.ts).
