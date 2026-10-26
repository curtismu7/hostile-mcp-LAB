import React, { useEffect, useState } from "react";
import { getCatalog } from "../lib/api.js";
import { PoisonCard } from "./Gallery.jsx";
import { TermsNote } from "../components/Terms.jsx";

// Which catalog rows prove each limit. A limit with no row says so rather than inventing evidence.
export const PROOF = {
  "first-list-poison": ["description_injection", "credential_harvest", "imperative_injection", "schema_exfiltration"],
  "blind-sink": ["schema_exfiltration", "action_exfil_sink"],
  "result-injection": ["result_injection"],
  "resources-prompts": ["resource_poisoning", "prompt_poisoning"],
};

export default function Limits() {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { getCatalog().then(setCatalog).catch((e) => setError(e.message)); }, []);
  return (
    <>
      <h2>What pinning does not catch</h2>
      <p className="lede">Pinning notices change. It does not judge content. A scanner or a person must vet the first list, and runtime controls must limit what a poisoned tool can do.</p>
      <TermsNote words={["pin", "pinned client", "ungoverned client"]} />
      {error && <p role="alert" className="alert">Could not load the catalog: {error}</p>}
      {!catalog && !error && <p className="muted">Loading the catalog...</p>}
      {catalog && (
        <>
          <section className="card" aria-labelledby="catches-h">
            <h3 id="catches-h">What it does catch</h3>
            <ul>{catalog.pinningCatches.map((c) => <li key={c.id}>{c.text}</li>)}</ul>
          </section>
          {catalog.pinningLimits.map((l) => {
            const rows = (PROOF[l.id] || []).map((id) => catalog.items.find((i) => i.id === id)).filter(Boolean);
            return (
              <section key={l.id} className="card limit" aria-labelledby={`lim-${l.id}`} data-testid={`limit-${l.id}`}>
                <h3 id={`lim-${l.id}`}>{l.text}</h3>
                {rows.length ? (
                  <>
                    <p className="muted small">Catalog rows that show it:</p>
                    <div className="grid">{rows.map((i) => <PoisonCard key={i.id} item={i} />)}</div>
                    {l.id === "first-list-poison" && <p><a href="#/run?stage=first&task=0">Run it on day one</a>: the pinned client approves the poison and it lands.</p>}
                  </>
                ) : <p className="muted small">No catalog row; this follows from how the pinned client works.</p>}
              </section>
            );
          })}
        </>
      )}
    </>
  );
}
