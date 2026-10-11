import nodemailer from 'nodemailer';

/**
 * Sends through SMTP (Gmail) or, without credentials, prints the email in
 * the logs: handy in development to copy the link, harmless in CI.
 */
export function createMailer(config, logger = console) {
  if (config.transport === 'log') {
    return {
      async send({ to, subject, text }) {
        logger.info(
          `[log transport, not sent] To: ${to}\nSubject: ${subject}\n\n${text}\n`,
        );
      },
    };
  }

  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: { user: config.smtp.user, pass: config.smtp.password },
  });
  return {
    async send({ to, subject, text, html }) {
      await transport.sendMail({ from: config.from, to, subject, text, html });
    },
  };
}
