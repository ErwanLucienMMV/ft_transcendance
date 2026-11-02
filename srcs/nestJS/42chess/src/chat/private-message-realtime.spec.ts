import { randomUUID } from 'node:crypto';
import { PrivateMessageRealtime } from './private-message-realtime.js';
import type { PrivateMessagesService } from './private-messages.service.js';
import type { PrivateMessageResponse } from '../messages/message-presenter.js';

describe('Private-message commit and delivery guarantees', () => {
  const alice = randomUUID(),
    bob = randomUUID(),
    other = randomUUID();
  const saved: PrivateMessageResponse = {
    id: randomUUID(),
    senderId: alice,
    receiverId: bob,
    content: 'hello',
    createdAt: '2026-10-01T12:00:00.000Z',
  };
  const data = { receiverId: bob, content: saved.content };
  const connection = (userId: string) => ({
    userId,
    connected: vi.fn(() => true),
    validate: vi.fn(async () => {}),
    send: vi.fn(),
  });

  it('announces nothing while persistence is pending, then uses the database-owned response', async () => {
    let commit!: (row: PrivateMessageResponse) => void;
    const send = vi.fn(
      () =>
        new Promise<PrivateMessageResponse>((resolve) => {
          commit = resolve;
        }),
    );
    const delivery = new PrivateMessageRealtime({
      send,
    } as unknown as PrivateMessagesService);
    const sender = connection(alice),
      recipient = connection(bob),
      outsider = connection(other);
    delivery.connect('sender', sender);
    delivery.connect('recipient', recipient);
    delivery.connect('outsider', outsider);
    const pending = delivery.send(alice, data);
    await Promise.resolve();
    expect(sender.send).not.toHaveBeenCalled();
    expect(recipient.send).not.toHaveBeenCalled();
    commit(saved);
    await pending;
    expect(sender.send.mock.calls).toEqual([['PRIVATE_MESSAGE', saved]]);
    expect(recipient.send.mock.calls).toEqual([['PRIVATE_MESSAGE', saved]]);
    expect(outsider.send).not.toHaveBeenCalled();
  });

  it('does not announce a failed save to any participant', async () => {
    const error = new Error('database unavailable');
    const delivery = new PrivateMessageRealtime({
      send: vi.fn().mockRejectedValue(error),
    } as unknown as PrivateMessagesService);
    const sender = connection(alice),
      recipient = connection(bob);
    delivery.connect('sender', sender);
    delivery.connect('recipient', recipient);
    await expect(delivery.send(alice, data)).rejects.toBe(error);
    expect(sender.send).not.toHaveBeenCalled();
    expect(recipient.send).not.toHaveBeenCalled();
  });

  it('does not turn a broken socket into a failed send or suppress another valid session', async () => {
    const delivery = new PrivateMessageRealtime({
      send: vi.fn().mockResolvedValue(saved),
    } as unknown as PrivateMessagesService);
    const sender = connection(alice),
      broken = connection(bob),
      revoked = connection(bob),
      valid = connection(bob);
    broken.send.mockImplementation(() => {
      throw new Error('transport closed');
    });
    revoked.validate.mockRejectedValue(new Error('session revoked'));
    delivery.connect('sender', sender);
    delivery.connect('broken', broken);
    delivery.connect('revoked', revoked);
    delivery.connect('valid', valid);
    await expect(delivery.send(alice, data)).resolves.toBeUndefined();
    expect(sender.send.mock.calls).toEqual([['PRIVATE_MESSAGE', saved]]);
    expect(revoked.send).not.toHaveBeenCalled();
    expect(valid.send.mock.calls).toEqual([['PRIVATE_MESSAGE', saved]]);
  });

  it('does not send to a connection that disconnects during session validation', async () => {
    const delivery = new PrivateMessageRealtime({
      send: vi.fn().mockResolvedValue(saved),
    } as unknown as PrivateMessagesService);
    const recipient = connection(bob);
    recipient.validate.mockImplementation(async () => {
      delivery.disconnect('recipient');
    });
    delivery.connect('recipient', recipient);
    await delivery.send(alice, data);
    expect(recipient.send).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)(
    'bounds a stalled validation to one second and ignores its late %s',
    async (late) => {
      vi.useFakeTimers();
      let finish!: () => void;
      const gate = new Promise<void>((resolve, reject) => {
        finish = () =>
          late === 'resolve'
            ? resolve()
            : reject(new Error('late session rejection'));
      });
      const delivery = new PrivateMessageRealtime({
        send: vi.fn().mockResolvedValue(saved),
      } as unknown as PrivateMessagesService);
      const slow = connection(bob),
        sender = connection(alice);
      slow.validate.mockImplementation(() => gate);
      delivery.connect('slow', slow);
      delivery.connect('sender', sender);
      let complete = false;
      const pending = delivery.send(alice, data).then(() => {
        complete = true;
      });
      try {
        await vi.advanceTimersByTimeAsync(0);
        expect(sender.send.mock.calls).toEqual([['PRIVATE_MESSAGE', saved]]);
        await vi.advanceTimersByTimeAsync(999);
        expect(complete).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(complete).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        finish();
        await Promise.resolve();
        expect(slow.send).not.toHaveBeenCalled();
      } finally {
        finish();
        await pending;
        delivery.onModuleDestroy();
        vi.useRealTimers();
      }
    },
  );
});
