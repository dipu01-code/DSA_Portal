import { insertAt, straightenQuotes } from './editor';

describe('editor helpers', () => {
  it('inserts at the cursor and moves the cursor after the text', () => {
    expect(insertAt('ab', { start: 1, end: 1 }, '{')).toEqual({ value: 'a{b', cursor: 2 });
  });
  it('replaces a selection', () => {
    expect(insertAt('return x;', { start: 7, end: 8 }, 'y')).toEqual({
      value: 'return y;',
      cursor: 8,
    });
  });
  it('clamps a stale selection to the text', () => {
    expect(insertAt('ab', { start: 9, end: 12 }, ';')).toEqual({ value: 'ab;', cursor: 3 });
  });
  it('straightens iOS smart quotes', () => {
    expect(straightenQuotes('const s = “hi” + ‘x’;')).toBe(`const s = "hi" + 'x';`);
  });
});
