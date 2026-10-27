import { expect, test } from '@playwright/test';

test('upgrades through the development proxy and refuses an invalid access token', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(
    () =>
      new Promise<{ code: string; close: number }>((resolve, reject) => {
        const socket = new WebSocket(`ws://${location.host}/ws`);
        const timeout = setTimeout(() => {
          socket.close();
          reject(new Error('Realtime handshake timed out'));
        }, 5000);
        let code = '';
        socket.onopen = () =>
          socket.send(
            JSON.stringify({
              event: 'AUTHENTICATE',
              data: { accessToken: 'untrusted-browser-test-token' },
            }),
          );
        socket.onmessage = (message) => {
          const packet = JSON.parse(message.data);
          if (packet.event === 'ERROR') code = packet.data.code;
        };
        socket.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('Realtime upgrade failed'));
        };
        socket.onclose = (event) => {
          clearTimeout(timeout);
          resolve({ code, close: event.code });
        };
      }),
  );
  expect(result).toEqual({ code: 'INVALID_TOKEN', close: 4401 });
});
