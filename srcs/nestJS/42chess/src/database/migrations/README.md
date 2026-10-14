# Database migrations

Put timestamped TypeORM migrations in this directory. They are compiled to
`dist/database/migrations` and applied automatically when the API starts.
`npm run migration:run` stays available to apply them by hand.
`dist/database/migrations` and run explicitly with `npm run migration:run`.
Application startup never modifies the schema automatically.

There is no initial business schema yet: the users and games models belong to
their respective tickets. Do not create placeholder tables here.

See [DATABASE.md](../../../DATABASE.md) for creation, execution and rollback.
