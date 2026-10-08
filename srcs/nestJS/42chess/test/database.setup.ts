// Deliberately ignore DATABASE_* from the shell and srcs/.env.
// Only the host port is configurable; database and credentials match the fixture.
Object.assign(process.env, {
  APIPORT: '3000',
  DATABASE_HOST: '127.0.0.1',
  DATABASE_PORT: process.env.TEST_DATABASE_PORT ?? '55432',
  DATABASE_NAME: 'transcendence_test',
  DATABASE_USER: 'foundation_test',
  DATABASE_PASSWORD: 'foundation_test_only',
});
