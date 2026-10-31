import { randomUUID } from 'node:crypto';
import { QueryFailedError, type Repository } from 'typeorm';
import { PrivateMessagesService } from './private-messages.service.js';
import { Message } from '../messages/messages.entity.js';
import type { User } from '../users/user.entity.js';

describe('Private-message recipient validation (SCRUM-251/255)', () => {
  const senderId = randomUUID(),
    receiverId = randomUUID();
  const failure = (code: string, constraint: string) =>
    new QueryFailedError(
      'INSERT INTO messages ...',
      [],
      Object.assign(new Error('database write failed'), { code, constraint }),
    );

  function setup(error?: Error) {
    const create = vi.fn((input) => Object.assign(new Message(), input));
    const save = vi.fn().mockRejectedValue(error);
    const existsBy = vi.fn().mockResolvedValue(true);
    const service = new PrivateMessagesService(
      { create, save } as unknown as Repository<Message>,
      { existsBy } as unknown as Repository<User>,
    );
    return { service, create, save, existsBy };
  }

  it('rejects a missing recipient before attempting any write', async () => {
    const { service, create, save, existsBy } = setup();
    existsBy.mockResolvedValue(false);
    await expect(
      service.send(senderId, receiverId, 'hello'),
    ).rejects.toMatchObject({
      response: {
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: 'User not found.',
      },
    });
    expect(create).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('returns the same not-found error if the recipient disappears after the existence check', async () => {
    const { service, existsBy, save } = setup(
      failure('23503', 'FK_messages_recipientId'),
    );
    await expect(
      service.send(senderId, receiverId.toUpperCase(), 'hello'),
    ).rejects.toMatchObject({
      response: {
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: 'User not found.',
      },
    });
    expect(existsBy).toHaveBeenCalledExactlyOnceWith({ id: receiverId });
    expect(save).toHaveBeenCalledOnce();
  });

  it.each([
    failure('23503', 'FK_messages_senderId'),
    failure('23503', 'another_constraint'),
    failure('23514', 'FK_messages_recipientId'),
    new Error('connection unavailable'),
    Object.assign(new Error('not a database query error'), {
      code: '23503',
      constraint: 'FK_messages_recipientId',
    }),
  ])('preserves unrelated persistence errors: %s', async (error) => {
    const { service } = setup(error);
    await expect(service.send(senderId, receiverId, 'hello')).rejects.toBe(
      error,
    );
  });
});
