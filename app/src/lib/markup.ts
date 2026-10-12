// The inline markup allowed in data: **bold**, *italic*, `mono`. Anything else is plain text.
export type Run = { kind: "text" | "b" | "i" | "mono"; text: string };

const TOKEN = /(\*\*[^*]+?\*\*|`[^`]+?`|\*[^*\s][^*]*?\*)/g;

export function parseMarkup(s: string): Run[] {
  const out: Run[] = [];
  let last = 0;
  for (const m of s.matchAll(TOKEN)) {
    if (m.index! > last) out.push({ kind: "text", text: s.slice(last, m.index) });
    const t = m[0];
    if (t.startsWith("**")) out.push({ kind: "b", text: t.slice(2, -2) });
    else if (t.startsWith("`")) out.push({ kind: "mono", text: t.slice(1, -1) });
    else out.push({ kind: "i", text: t.slice(1, -1) });
    last = m.index! + t.length;
  }
  if (last < s.length) out.push({ kind: "text", text: s.slice(last) });
  return out;
}

/** Plain text, for aria labels and titles. */
export const stripMarkup = (s: string) => parseMarkup(s).map(r => r.text).join("");
