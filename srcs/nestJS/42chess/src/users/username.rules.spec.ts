import { isReservedUsername } from './username.rules.js';

describe('isReservedUsername', () => {
  it.each(['admin', 'Admin', 'GUEST', 'StockFish', 'me'])(
    'rejects %s whatever its case',
    (username) => {
      expect(isReservedUsername(username)).toBe(true);
    },
  );

  it.each(['alice', 'admin42', 'the_guest', 'mee'])(
    'allows %s, which only contains a reserved word',
    (username) => {
      expect(isReservedUsername(username)).toBe(false);
    },
  );
});
