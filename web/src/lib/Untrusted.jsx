import React from "react";

// Everything the hostile server sends is untrusted by definition. It is only ever rendered as React text nodes
// (never innerHTML), so markup in a payload is shown, not run. The <mark> highlight is derived from the text by
// pattern and wraps text nodes only.
const HOT = /<IMPORTANT>[\s\S]*?<\/IMPORTANT>|ignore (?:all )?(?:previous|prior) instructions[\s\S]*|https?:\/\/[^\s"',]+|[\w.+-]+@[\w.-]+\.[a-z]+/gi;

export function segments(text) {
  const s = String(text ?? "");
  const out = [];
  let last = 0;
  for (const m of s.matchAll(HOT)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), hot: false });
    out.push({ text: m[0], hot: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), hot: false });
  return out;
}

/** Inert text with suspicious spans highlighted. Highlight carries a title and the text itself, not colour alone. */
export function Untrusted({ text, block = false }) {
  const Tag = block ? "pre" : "span";
  return (
    <Tag className={`untrusted${block ? " untrusted--block" : ""}`} data-testid="untrusted">
      {segments(text).map((p, i) => (p.hot ? <mark key={i} title="Flagged: instruction or off-box address">{p.text}</mark> : <React.Fragment key={i}>{p.text}</React.Fragment>))}
    </Tag>
  );
}

const CHIP = /(\[U\+[0-9A-F]{4,6}\])/;

/** Text from the server's revealed copy: each [U+XXXX] chip is a visible, styled text node, everything else is inert text. */
export function Revealed({ text, block = false }) {
  const Tag = block ? "pre" : "span";
  return (
    <Tag className={`untrusted${block ? " untrusted--block" : ""}`} data-testid="revealed">
      {String(text ?? "").split(CHIP).map((p, i) => (i % 2 ? <span key={i} className="chip" title="Invisible or look-alike character">{p}</span> : <React.Fragment key={i}>{p}</React.Fragment>))}
    </Tag>
  );
}

export const pretty = (value) => JSON.stringify(value, null, 2);
