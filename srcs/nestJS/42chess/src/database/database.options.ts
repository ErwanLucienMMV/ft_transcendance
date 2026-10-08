import { fileURLToPath } from 'node:url';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import type { Environment } from '../config/environment.js';

export function databaseOptions(env: Environment): PostgresConnectionOptions {
  return {
    type: 'postgres',
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    database: env.DATABASE_NAME,
    username: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    entities: [fileURLToPath(new URL('../**/*.entity.js', import.meta.url))],
    migrations: [fileURLToPath(new URL('./migrations/*.js', import.meta.url))],
    migrationsTableName: 'typeorm_migrations',
    migrationsTransactionMode: 'all',
    synchronize: false,
    migrationsRun: false,
    dropSchema: false,
    logging: false,
    extra: { max: 10, connectionTimeoutMillis: 5000 },
  };
}
