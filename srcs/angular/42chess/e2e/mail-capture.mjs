// Test-only mail sink. It is never built into forgemail or the production API.
import { createServer } from 'node:http';
const messages = new Map();
createServer(async (request, response) => {
  const url = new URL(request.url, 'http://mail-capture');
  response.setHeader('Content-Type', 'application/json');
  if (request.method === 'GET' && url.pathname === '/health') return response.end('{}');
  // The last mail of a kind sent to an address: email-verification (default), password-reset,
  // or notice (whose `kind` field says which one).
  if (request.method === 'GET' && url.pathname === '/_test/message') {
    const kind = url.searchParams.get('kind') ?? 'email-verification';
    const message = messages.get(`${kind}:${url.searchParams.get('to')}`);
    response.statusCode = message ? 200 : 404;
    return response.end(JSON.stringify(message ?? {}));
  }
  const kind = /^\/v1\/mails\/(email-verification|password-reset|notice)$/.exec(url.pathname)?.[1];
  if (request.method === 'POST' && kind) {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 65536) {
        response.statusCode = 413;
        return response.end('{}');
      }
    }
    try {
      const message = JSON.parse(body);
      if (
        typeof message.to !== 'string' ||
        (kind === 'notice' ? typeof message.kind !== 'string' : typeof message.token !== 'string')
      )
        throw new Error('Invalid mail');
      messages.set(`${kind}:${message.to}`, message);
      response.statusCode = 202;
      return response.end('{}');
    } catch {
      response.statusCode = 400;
      return response.end('{}');
    }
  }
  response.statusCode = 404;
  response.end('{}');
}).listen(3002, '0.0.0.0');
