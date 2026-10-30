# Database migrations

Put timestamped TypeORM migrations in this directory. They are compiled to
`dist/database/migrations` and applied automatically when the API starts.
`npm run migration:run` stays available to apply them by hand.
Both paths check the database requirements (PostgreSQL 15 or newer, UTF8)
before applying migrations. Startup applies pending migrations in a transaction;
automatic schema synchronization and schema dropping remain disabled.

Existing timestamped migrations create the users, games and other domain
tables. Add forward migrations for changes; preserve existing migration history
and verify upgrades with representative stored data as well as empty databases.

See [DATABASE.md](../../../DATABASE.md) for creation, execution and rollback.
