# Validation

Validated for this change with GCC 13.3, Boost 1.83, nlohmann/json 3.11.3,
CMake 3.28.3, Python 3 and Node 24.19. The deployment images use Node 22 and
Debian Bookworm system C++ dependencies; Docker itself was unavailable in the
implementation environment, so the Docker image was not built here.

- Make: executable and both C++ test executables build with warnings as errors.
- CMake Release: executable and tests build; CTest passes 2/2 suites.
- Rules: 198 checks pass across 11 suites, including reference perft counts.
- JSON protocol: 27 checks pass.
- WebSocket integration against the real executable: passes handshake validation,
  legal requests, invalid JSON recovery, fragmented text messages, ping/pong,
  24 concurrent-client requests, repetition, binary/oversized-frame rejection,
  close handshake and SIGTERM shutdown.
- NestJS: existing `npm run build` succeeds and existing Vitest tests pass (2/2).
- Compiled `ChessEngineService` integration against the real executable passes
  analysis, validation, successful/illegal moves, eight concurrent requests,
  checkmate and connection failure after engine shutdown.
- AddressSanitizer and UndefinedBehaviorSanitizer: all 198 rule checks pass.
  LeakSanitizer could not inspect processes in the sandbox, so this run used
  `ASAN_OPTIONS=detect_leaks=0`. No leak-check result is claimed.
- Both Compose files parse as YAML and contain the internal engine service.
- `git diff --check` passes.

Commands for reproduction are in README.md. The ZIP intentionally omits local
build output and node_modules; it includes source, tests, documentation and the
repository's full Git history, including the new implementation commits.
