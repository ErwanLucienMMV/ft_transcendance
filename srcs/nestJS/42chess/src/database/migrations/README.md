# Database migrations

Put timestamped TypeORM migrations in this directory. They are compiled to
`dist/database/migrations` and run explicitly with `npm run migration:run`.
Application startup never modifies the schema automatically.

There is no initial business schema yet: the users and games models belong to
their respective tickets. Do not create placeholder tables here.

See [DATABASE.md](../../../DATABASE.md) for creation, execution and rollback.
