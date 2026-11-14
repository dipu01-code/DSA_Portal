/** Keys that are slow to reach on phone keyboards, shown in a bar above the editor. */
export const EDITOR_KEYS = [
  '  ',
  '{',
  '}',
  '(',
  ')',
  '[',
  ']',
  ';',
  '=',
  '=>',
  "'",
  '"',
  '.',
  '<',
  '>',
] as const;

/** Inserts `text` over the current selection; returns the new value and where the cursor goes. */
export function insertAt(value: string, sel: { start: number; end: number }, text: string) {
  const start = Math.max(0, Math.min(sel.start, value.length));
  const end = Math.max(start, Math.min(sel.end, value.length));
  return { value: value.slice(0, start) + text + value.slice(end), cursor: start + text.length };
}

/** iOS "smart punctuation" turns quotes into curly ones, which are syntax errors in JavaScript. */
export const straightenQuotes = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
