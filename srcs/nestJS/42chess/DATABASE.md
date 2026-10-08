# Backend configuration and PostgreSQL

This foundation covers SCRUM-33, SCRUM-34, SCRUM-35 and SCRUM-443. It uses
Nest ConfigModule, TypeORM 0.3 and the `pg` driver. TypeORM is shared by Nest
and the migration CLI. Authentication and business entities are separate work.

## Configuration

Run all commands below from `srcs/nestJS/42chess` after `npm ci`.
The process environment overrides a local `.env`, which overrides `srcs/.env`.
Start with the existing `srcs/.env.example` and fill in the passwords locally.
Never commit your `.env`.

| Variable            | Meaning                                  |
| ------------------- | ---------------------------------------- |
| `APIPORT`           | HTTP port; defaults to `PORT`, then 3000 |
| `DATABASE_HOST`     | Required PostgreSQL host                 |
| `DATABASE_PORT`     | PostgreSQL port; defaults to 5432        |
| `DATABASE_NAME`     | Required database name                   |
| `DATABASE_USER`     | Required application role                |
| `DATABASE_PASSWORD` | Required non-empty password              |

Ports are validated as integers between 1 and 65535. Missing database settings
stop startup without printing credentials. The pool has at most 10 connections
and a 5-second connection timeout. Nest retries connection establishment three
times and releases the pool on shutdown.

For Docker development, run the existing `docker-compose.dev.yml` from `srcs`
with its `.env`. The backend receives the database settings and waits for
PostgreSQL's health check. The database initializer also needs the existing
`POSTGRES_BACKUP_USER` and `POSTGRES_BACKUP_PASSWORD` settings.
When running Node on the host, override `DATABASE_HOST=127.0.0.1` and use the
published PostgreSQL port instead of the Compose service hostname.

## Entities and migrations

Add entities as `src/<feature>/*.entity.ts`. Register them with
`TypeOrmModule.forFeature([YourEntity])` in their feature module to inject
repositories. Both the application and CLI discover compiled `*.entity.js`.
`synchronize`, automatic migrations on startup and automatic schema dropping
are disabled in every environment.

Create an empty migration:

```sh
npm run migration:create -- src/database/migrations/CreateYourTable
```

Or generate one after defining an entity, against your development database:

```sh
npm run migration:generate -- src/database/migrations/CreateYourTable
```

Review the generated SQL and its `down` rollback before applying it. Then:

```sh
npm run migration:show
npm run migration:run
npm run migration:revert
```

These commands rebuild the backend and use `dist/database/data-source.js`.
They connect using the same configuration as Nest. Migration history is stored
in `typeorm_migrations`, and pending migrations run in a transaction. No users
or games tables are created by this foundation. The first business migration
should accompany its entity; changing PostgreSQL's initialization script is
unnecessary.

## Isolated database tests

```sh
npm run test:db:up
npm test
npm run test:db
npm run test:e2e
npm run test:db:down
```

The test Compose project runs official PostgreSQL 15 on `127.0.0.1:55432`, with
database `transcendence_test` and disposable data in tmpfs. Its credentials are
test fixtures. It does not mount the application's `postgres_data` volume.
If that host port is occupied, set `TEST_DATABASE_PORT` to the same free port
for both the Compose and test commands.

Database and HTTP tests replace all application `DATABASE_*` variables with
these fixture settings, ignoring real credentials from the shell or `.env`.
They cannot target an arbitrary database name or host. Ordinary unit tests
do not require PostgreSQL. Integration tests use a random schema and remove
only that schema on completion; no production migration fixture is installed.

With Podman, the equivalent disposable fixture is:

```sh
podman run --detach --name transcendence-backend-tests \
  --publish 127.0.0.1:55432:5432 \
  --tmpfs /var/lib/postgresql/data:rw \
  --env POSTGRES_DB=transcendence_test \
  --env POSTGRES_USER=foundation_test \
  --env POSTGRES_PASSWORD=foundation_test_only docker.io/library/postgres:15
podman exec transcendence-backend-tests pg_isready -U foundation_test -d transcendence_test
# Run npm tests only once PostgreSQL is ready.
podman rm --force transcendence-backend-tests
```

Reference: [Nest configuration](https://docs.nestjs.com/techniques/configuration),
[Nest database integration](https://docs.nestjs.com/techniques/database),
[TypeORM migration commands](https://github.com/typeorm/typeorm/blob/0.3.31/docs/migrations.md).
