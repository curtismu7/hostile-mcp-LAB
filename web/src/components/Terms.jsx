import React from "react";

// Plain-language definitions for the words this demo uses. Shown on the first page and as hover text on key terms.
export const DEFINITIONS = {
  "ungoverned client": "A client that takes whatever the server sends and hands it straight to the assistant, with no check.",
  "pinned client": "A client that fingerprints each tool when someone approves it, and refuses any tool whose fingerprint changes later.",
  "pin": "Recording the fingerprint of an approved tool, so a later change can be spotted.",
  "hash": "A SHA-256 fingerprint of a tool's name, description and input schema. Any change to those fields changes the fingerprint.",
  "withheld": "Not passed to the assistant. The client keeps the tool out and shows what changed.",
  "victim": "The assistant that reads the tool list and plans calls from it. In this demo it is offline and has no model.",
  "rug-pull": "A server that behaves well when approved, then changes a tool's description later so it does something harmful.",
};

// A term with its definition as hover text (and read out by screen readers as the title).
export function Term({ word, children }) {
  const key = word ?? String(children).toLowerCase();
  return <abbr title={DEFINITIONS[key]}>{children}</abbr>;
}

export default function Terms() {
  return (
    <section className="card" aria-labelledby="terms-h">
      <h3 id="terms-h">Words used in this demo</h3>
      <dl>
        {Object.entries(DEFINITIONS).map(([word, def]) => (
          <React.Fragment key={word}>
            <dt><strong>{word.charAt(0).toUpperCase() + word.slice(1)}</strong></dt>
            <dd>{def}</dd>
          </React.Fragment>
        ))}
      </dl>
    </section>
  );
}
