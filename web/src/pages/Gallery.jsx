import React, { useEffect, useState } from "react";
import { getCatalog } from "../lib/api.js";
import StoryPanel from "../story/StoryPanel.jsx";

// Poison catalog grouped by category. The three badges come straight from the catalog data (scanner / pinning answers).
export const CATEGORIES = [
  ["description", "Instructions in a description"],
  ["schema", "Sinks in the input schema"],
  ["name", "Name shadowing"],
  ["dynamic", "Changes after approval"],
  ["result", "Instructions in a call result"],
  ["resource", "Poisoned resources"],
  ["prompt", "Poisoned prompts"],
];
const WORD = { yes: "", partial: " (partly)" };

export function badgesFor(item) {
  const b = [];
  if (item.pinning.catches !== "no") b.push({ id: "pin", level: item.pinning.catches, text: `Caught by pinning${WORD[item.pinning.catches]}` });
  if (item.scanner.catches !== "no") b.push({ id: "scan", level: item.scanner.catches, text: `Caught by a scanner at ingest${WORD[item.scanner.catches]}` });
  if (!b.length) b.push({ id: "neither", level: "no", text: "Neither: needs a human or a runtime control" });
  return b;
}

export function PoisonCard({ item }) {
  return (
    <article className="poison" data-testid={`poison-${item.id}`}>
      <h4><code>{item.name}</code> <span className="muted">{item.kind}</span></h4>
      <dl>
        <dt>What it does</dt><dd>{item.what}</dd>
        <dt>How it lands</dt><dd>{item.how}</dd>
      </dl>
      <ul className="badges" aria-label="Which control catches it">
        {badgesFor(item).map((b) => <li key={b.id} className={`pill ${b.level}`}>{b.text}</li>)}
      </ul>
      <p className="muted small"><strong>Pinning:</strong> {item.pinning.note} <strong>Scanner:</strong> {item.scanner.note}</p>
    </article>
  );
}

export default function Gallery({ present }) {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { getCatalog().then(setCatalog).catch((e) => setError(e.message)); }, []);
  return (
    <>
      <StoryPanel mode="gallery" present={present} />
      <h2>Poison gallery</h2>
      <p className="lede">Every poison the server can serve, grouped by where it hides. The badges say which control would catch it, taken from the catalog data. Nothing here is executed.</p>
      {error && <p role="alert" className="alert">Could not load the catalog: {error}</p>}
      {!catalog && !error && <p className="muted">Loading the catalog...</p>}
      {catalog && CATEGORIES.map(([id, title]) => {
        const items = catalog.items.filter((i) => i.category === id);
        if (!items.length) return null;
        return (
          <section key={id} className="card" aria-labelledby={`cat-${id}`}>
            <h3 id={`cat-${id}`}>{title}</h3>
            <div className="grid">{items.map((i) => <PoisonCard key={i.id} item={i} />)}</div>
          </section>
        );
      })}
    </>
  );
}
