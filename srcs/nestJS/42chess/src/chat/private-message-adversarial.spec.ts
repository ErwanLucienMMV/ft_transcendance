import { randomUUID } from 'node:crypto';
import { PrivateMessageRealtime } from './private-message-realtime.js';
import type { PrivateMessagesService } from './private-messages.service.js';
import type { PrivateMessageResponse } from '../messages/message-presenter.js';
import { parseRealtimeMessage } from '../realtime/realtime-messages.js';

describe('SCRUM-256 adversarial delivery isolation', () => {
  const senderId = randomUUID(),
    receiverId = randomUUID();
  const saved: PrivateMessageResponse = {
    id: randomUUID(),
    senderId,
    receiverId,
    content: 'durable',
    createdAt: '2026-10-01T12:00:00.000Z',
  };
  const client = (userId: string) => ({
    userId,
    connected: vi.fn(() => true),
    validate: vi.fn(async () => {}),
    send: vi.fn(),
  });
  const service = () => {
    const send = vi.fn().mockResolvedValue(saved);
    return {
      send,
      delivery: new PrivateMessageRealtime({
        send,
      } as unknown as PrivateMessagesService),
    };
  };

  it('delivers to healthy sessions while an earlier session validation is still pending', async () => {
    const { delivery } = service();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = client(receiverId),
      recipient = client(receiverId),
      sender = client(senderId);
    slow.validate.mockImplementation(() => gate);
    delivery.connect('slow', slow);
    delivery.connect('recipient', recipient);
    delivery.connect('sender', sender);
    const pending = delivery.send(senderId, {
      receiverId,
      content: saved.content,
    });
    try {
      await vi.waitFor(() => expect(slow.validate).toHaveBeenCalledOnce());
      await vi.waitFor(
        () => {
          expect(recipient.send).toHaveBeenCalledWith('PRIVATE_MESSAGE', saved);
          expect(sender.send).toHaveBeenCalledWith('PRIVATE_MESSAGE', saved);
        },
        { timeout: 250, interval: 10 },
      );
    } finally {
      // Always release the artificial stall, including when the assertion fails.
      release();
      await pending;
      delivery.onModuleDestroy();
    }
  });

  it('does not deliver a pending message to a replacement connection using the same ID', async () => {
    const { delivery } = service();
    const original = client(receiverId),
      replacement = client(randomUUID());
    original.validate.mockImplementation(async () =>
      delivery.connect('tab', replacement),
    );
    delivery.connect('tab', original);
    await delivery.send(senderId, { receiverId, content: saved.content });
    expect(original.send).not.toHaveBeenCalled();
    expect(replacement.send).not.toHaveBeenCalled();
  });

  it('rechecks connectivity after validation and still delivers to another active tab', async () => {
    const { delivery } = service();
    const expired = client(receiverId),
      active = client(receiverId);
    expired.validate.mockImplementation(async () => {
      expired.connected.mockReturnValue(false);
    });
    delivery.connect('expired', expired);
    delivery.connect('active', active);
    await delivery.send(senderId, { receiverId, content: saved.content });
    expect(expired.send).not.toHaveBeenCalled();
    expect(active.send).toHaveBeenCalledExactlyOnceWith(
      'PRIVATE_MESSAGE',
      saved,
    );
  });

  it.each(['senderId', 'recipientId', 'readAt', '__proto__', 'constructor'])(
    'rejects injected %s before persistence',
    async (key) => {
      const { send, delivery } = service();
      const data = JSON.parse(
        JSON.stringify({ receiverId, content: 'text', [key]: 'forged' }),
      );
      await expect(delivery.send(senderId, data)).rejects.toMatchObject({
        status: 400,
      });
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each([null, [], 'text', 42, true])(
    'rejects non-object private-message data %j at the transport boundary',
    (data) => {
      expect(() =>
        parseRealtimeMessage(
          JSON.stringify({ event: 'SEND_PRIVATE_MESSAGE', data }),
        ),
      ).toThrow();
    },
  );
});
