import React, { useEffect, useState } from "react";

// HM0 skeleton: shows the catalog the API serves and how each poison fares against a metadata scanner and against pinning.
// The side-by-side story (S05), the diagram and the sessions UI come in the next step.
const label = { yes: "Catches", partial: "Partly", no: "Misses" };

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/catalog")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setCatalog)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <main className="page">
      <h1>Hostile MCP</h1>
      <p className="lede">
        A deliberately hostile MCP server, and what a pinned client does and does not catch. The server serves payloads and never judges them.
      </p>
      {error && <p role="alert">Could not load the catalog: {error}</p>}
      {!catalog && !error && <p className="muted">Loading the catalog...</p>}
      {catalog && (
        <>
          <section className="card" aria-labelledby="catalog-h">
            <h2 id="catalog-h">Poison catalog</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Poison</th><th>How it lands</th><th>Metadata scanner</th><th>Pinning</th></tr>
                </thead>
                <tbody>
                  {catalog.items.map((i) => (
                    <tr key={i.id}>
                      <td><code>{i.name}</code><br /><span className="muted">{i.category}</span></td>
                      <td>{i.how}</td>
                      <td><span className={`pill ${i.scanner.catches}`}>{label[i.scanner.catches]}</span> {i.scanner.note}</td>
                      <td><span className={`pill ${i.pinning.catches}`}>{label[i.pinning.catches]}</span> {i.pinning.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="card" aria-labelledby="limits-h">
            <h2 id="limits-h">What pinning does not catch</h2>
            <ul>{catalog.pinningLimits.map((l) => <li key={l.id}>{l.text}</li>)}</ul>
          </section>
        </>
      )}
    </main>
  );
}
