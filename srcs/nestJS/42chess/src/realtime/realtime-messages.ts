import { BadRequestException, Injectable } from '@nestjs/common';

export interface RealtimeMessage {
  event: string;
  data: Record<string, unknown>;
}
export interface RealtimeClient {
  readonly userId: string;
  readonly connectionId: string;
  connected(): boolean;
  send(event: string, data: unknown): void;
}

export function parseRealtimeMessage(text: string): RealtimeMessage {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BadRequestException('Expected a JSON message.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Expected an event and data object.');
  const envelope = value as Record<string, unknown>;
  if (
    Object.keys(envelope).some((key) => !['event', 'data'].includes(key)) ||
    typeof envelope.event !== 'string' ||
    !/^[A-Z_]{1,40}$/.test(envelope.event) ||
    !envelope.data ||
    typeof envelope.data !== 'object' ||
    Array.isArray(envelope.data)
  ) {
    throw new BadRequestException('Expected an event and data object.');
  }
  return {
    event: envelope.event,
    data: envelope.data as Record<string, unknown>,
  };
}

@Injectable()
export class RealtimeMessages {
  async handle(
    _client: RealtimeClient,
    _message: RealtimeMessage,
  ): Promise<void> {
    throw new BadRequestException({
      statusCode: 400,
      code: 'UNKNOWN_EVENT',
      message: 'Unsupported realtime event.',
    });
  }
  disconnect(_connectionId: string): void {}
}
