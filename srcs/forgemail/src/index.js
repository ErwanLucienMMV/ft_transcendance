import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createMailer } from './mailer.js';

const config = loadConfig();
const mailer = createMailer(config);
const server = createServer(createApp({ config, mailer }));

server.listen(config.port, () => {
  console.info(
    `forgemail listening on ${config.port} (transport: ${config.transport})`,
  );
});

// Docker stops containers with SIGTERM: finish in-flight requests first.
process.on('SIGTERM', () => server.close(() => process.exit(0)));
