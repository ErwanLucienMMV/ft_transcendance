# Lichess puzzle data

Data only: Creative Commons CC0 1.0 Universal (CC0-1.0).

License: https://creativecommons.org/publicdomain/zero/1.0/
Official source and format: https://database.lichess.org/#puzzles

Downloaded on 2026-10-21. The license applies to these CSV datasets, not to application source code.

- `lichess-starter.csv`: header and first 128 records from https://database.lichess.org/lichess_db_puzzle.csv.zst, preserved as downloaded.
- `lichess-sample.csv`: four sample records published on the official database documentation page.

The setup move is the first UCI move; the solver starts after it. Ratings and tags are the source snapshot, not live values. The importer validates the actual variation with the project rules engine.

SHA-256:

- `lichess-starter.csv`: `60444f52cbc23570994ea785a769a44ff86058de6a6bb4fbf229b213137349b4`
- `lichess-sample.csv`: `a412fba133261d29195c733bfad27eaff0e5afa5443782ea126e0d24a19d24b3`
