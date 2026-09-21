/** Word boundaries expressed in the engine's UTF-16 offsets, without splitting surrogate pairs. */
export function wordSelectionBounds(text: string, column: number) {
  let offset = 0;
  const chars = Array.from(text, value => {
    const start = offset; offset += value.length;
    return { value, start, end: offset };
  });
  if (!chars.length) return { start: 0, end: 0 };
  const at = Math.max(0, Math.min(column, text.length - 1));
  const index = chars.findIndex(c => c.end > at);
  const kind = (value: string) => /[\p{L}\p{N}\p{M}_]/u.test(value) ? "word" : /\s/u.test(value) ? "space" : "symbol";
  const category = kind(chars[index].value);
  let first = index, last = index;
  if (category !== "symbol") {
    while (first > 0 && kind(chars[first - 1].value) === category) first--;
    while (last + 1 < chars.length && kind(chars[last + 1].value) === category) last++;
  }
  return { start: chars[first].start, end: chars[last].end };
}
