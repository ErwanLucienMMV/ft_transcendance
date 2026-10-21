import { csvFields } from './puzzle-import.js';

describe('Lichess CSV parsing', () => {
  it('preserves empty columns, quoted commas and escaped quotes', () => {
    expect(csvFields('a,"b,c","d""e",,')).toEqual(['a', 'b,c', 'd"e', '', '']);
  });
  it.each(['a,"unclosed', 'a,"b"x', 'a,b"c'])(
    'rejects malformed input: %s',
    (line) => {
      expect(() => csvFields(line)).toThrow(/CSV/);
    },
  );
});
