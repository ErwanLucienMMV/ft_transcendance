import { DataSource } from 'typeorm';

export default async function setup() {
  // Configure the dedicated e2e database before importing the app data source.
  Object.assign(process.env, {
    APIPORT: '3000',
    DATABASE_HOST: process.env.TEST_DATABASE_HOST ?? '127.0.0.1',
    DATABASE_PORT: process.env.TEST_DATABASE_PORT ?? '55432',
    DATABASE_NAME: 'transcendence_test',
    DATABASE_USER: 'foundation_test',
    DATABASE_PASSWORD: 'foundation_test_only',
  });

  // Import only after the environment has been initialized.
  const { default: cliDataSource } =
    await import('../dist/database/data-source.js');

  const source = new DataSource(cliDataSource.options);

  await source.initialize();

  try {
    await source.runMigrations();
  } finally {
    await source.destroy();
  }
}
