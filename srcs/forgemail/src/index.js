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
  const { token, recipients } = config.alerts;
  console.info(
    !token
      ? 'monitoring alerts: refused (ALERT_WEBHOOK_TOKEN is not set)'
      : recipients.length
        ? `monitoring alerts: emailed to ${recipients.length} address(es)`
        : 'monitoring alerts: logged only (ALERT_EMAIL is empty)',
  );
});

// Docker stops containers with SIGTERM: finish in-flight requests first.
process.on('SIGTERM', () => server.close(() => process.exit(0)));
