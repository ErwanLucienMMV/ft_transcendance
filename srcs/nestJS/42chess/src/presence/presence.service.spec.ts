import { randomUUID } from 'node:crypto';
import { PresenceService } from './presence.service.js';

describe('SCRUM-238 presence service', () => {
  const first = randomUUID(),
    second = randomUUID();
  let presence: PresenceService;
  beforeEach(() => {
    presence = new PresenceService();
  });

  it('starts with no connected users and independent offline snapshots', () => {
    expect(presence.get(first)).toEqual({
      userId: first,
      status: 'OFFLINE',
      lastSeen: null,
    });
    expect(presence.isOnline(second)).toBe(false);
  });
  it('tracks several tabs per account and keeps accounts separate', () => {
    expect(presence.connect(first, 'tab-one')).toBe(true);
    expect(presence.connect(first, 'tab-two')).toBe(false);
    expect(presence.isOnline(first)).toBe(true);
    expect(presence.isOnline(second)).toBe(false);
    expect(presence.disconnect(first, 'tab-one')).toBe(false);
    expect(presence.get(first).status).toBe('ONLINE');
    expect(presence.disconnect(first, 'tab-two')).toBe(true);
    expect(presence.get(first).status).toBe('OFFLINE');
  });
  it('makes duplicate connection and disconnect notifications idempotent', () => {
    const connected = new Date('2026-10-01T00:00:00Z');
    const disconnected = new Date('2026-10-01T00:01:00Z');
    presence.connect(first, 'tab', connected);
    presence.connect(first, 'tab', disconnected);
    expect(presence.get(first).lastSeen).toEqual(connected);
    expect(presence.disconnect(first, 'unknown')).toBe(false);
    expect(presence.disconnect(second, 'tab')).toBe(false);
    expect(presence.disconnect(first, 'tab', disconnected)).toBe(true);
    expect(presence.disconnect(first, 'tab')).toBe(false);
    expect(presence.get(first).lastSeen).toEqual(disconnected);
  });
  it('returns date snapshots that cannot modify the registry', () => {
    const at = new Date('2026-10-01T00:00:00Z');
    presence.connect(first, 'tab', at);
    at.setFullYear(2030);
    presence.get(first).lastSeen!.setFullYear(2040);
    expect(presence.get(first).lastSeen?.toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
  });
  it('uses one canonical UUID identity regardless of case', () => {
    presence.connect(first.toUpperCase(), 'tab');
    expect(presence.get(first).status).toBe('ONLINE');
    expect(presence.disconnect(first, 'tab')).toBe(true);
  });
  it.each(['', 'not-a-uuid', undefined, null])(
    'rejects invalid user identifiers %j',
    (id) => {
      expect(() => presence.connect(id as string, 'tab')).toThrow(RangeError);
      expect(() => presence.get(id as string)).toThrow(RangeError);
    },
  );
});
