import React from "react";
import { DEFINITIONS } from "./Terms.jsx";
import { Untrusted } from "../lib/Untrusted.jsx";
import Json from "./JsonPane.jsx";
import { CLEAN_DESC, HASH_APPROVED, HASH_NOW, ORDER, POISON_DESC, WIRE } from "../data/wire.js";

// "On the wire": the messages behind a diagram step. Everything is example data (see data/wire.js). The hostile text
// is only ever rendered as React text, never as markup (the shared JsonPane, Rule 24, through visible()).
// The keys a reader looks for in these JSON-RPC messages; on the poisoned response the description field stands out too.
const HOT = ["method", "name", "arguments", "to", "amount"];
const WORDS = ["json-rpc", "tools/list", "tools/call", "input schema", "hash", "pinned client", "ungoverned client", "rug-pull"];

function Message({ label, msg, poison }) {
  // One HTTP transcript string: JsonPane keeps the request / status line and headers as text and gives the body its own Form | JSON pane.
  const wire = `${msg.head.join("\n")}\n\n${JSON.stringify(msg.body, null, 2)}`;
  return (
    <div className="wire__msg">
      <h4>{label}{msg.planned && <span className="pill partial">Planned, never sent</span>}</h4>
      <Json value={wire} label={label} testId={`wire-${label.toLowerCase()}`} hot={poison ? [...HOT, "description"] : HOT} />
      {poison && (msg.body.result?.tools ?? []).map((t) => (
        // The same description again as untrusted text: the shared marker flags exactly the injected <IMPORTANT> block.
        <p key={t.name} className="small" data-testid={`wire-poison-${t.name}`}><strong>{t.name} description, as untrusted text:</strong> <Untrusted text={t.description} /></p>
      ))}
    </div>
  );
}

function Hashes() {
  const rows = [
    ["name", "get_stock_price", "get_stock_price", false, "Same tool name."],
    ["description", CLEAN_DESC, POISON_DESC, true, "Changed: this is the field the attacker rewrote."],
    ["inputSchema", "{ symbol }", "{ symbol }", false, "Same input fields."],
    ["SHA-256", HASH_APPROVED, HASH_NOW, true, "The fingerprint of the three fields above. Different text gives a different fingerprint, so the client knows something changed."],
  ];
  return (
    <div className="table-wrap">
      <table className="wire__table">
        <thead><tr><th scope="col">Field</th><th scope="col">At approval</th><th scope="col">Now</th><th scope="col">What this means</th></tr></thead>
        <tbody>
          {rows.map(([f, a, b, changed, why]) => (
            <tr key={f} className={changed ? "is-changed" : undefined}>
              <th scope="row">{f}</th>
              <td><code>{a}</code></td>
              <td>{f === "description" ? <Untrusted text={b} /> : <code>{b}</code>}</td>
              <td>{why}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function WireDetail({ stepId, onSelect }) {
  const s = WIRE[stepId] ?? WIRE.e1;
  return (
    <section className="card wire" aria-labelledby="wire-h" data-testid="wire-detail">
      <h3 id="wire-h">On the wire <span className="pill partial">Example data, nothing real</span></h3>
      <p className="muted small">Pick a step to see the messages behind it. A <abbr title={DEFINITIONS["json-rpc"]}>JSON-RPC</abbr> message is a small JSON object with a method name; MCP uses it for every request.</p>
      <div className="seg" role="group" aria-label="Wire step">
        {ORDER.map((id, i) => <button key={id} type="button" aria-pressed={id === stepId} onClick={() => onSelect(id)}>{`${i + 1}. ${WIRE[id].title.replace(/^\d+\.\s*/, "")}`}</button>)}
      </div>
      <h4>{s.title}</h4>
      <p className="muted small">{s.from} to {s.to}</p>
      {s.empty ? <p className="wire__empty"><strong>No network call here.</strong> {s.empty.replace(/^No network call here:\s*/, "")}</p> : (
        <div className="cols">
          <Message label="Request" msg={s.request} />
          <Message label="Response" msg={s.response} poison={s.poison} />
        </div>
      )}
      {s.hashes && <Hashes />}
      <p className="muted small"><strong>Token.</strong> {s.token ?? "No token is in play on this step."} <a href="https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization" target="_blank" rel="noreferrer">MCP authorization spec</a></p>
      {s.gateway && <p className="muted small"><strong>Allow or deny.</strong> {s.gateway}</p>}
      <p className="wire__notice"><strong>What to notice.</strong> {s.notice}</p>
      <dl className="wire__clients">
        <dt>Ungoverned client</dt><dd>{s.ungoverned}</dd>
        <dt>Pinned client</dt><dd>{s.pinned}</dd>
      </dl>
      <details>
        <summary>Words on this step</summary>
        <dl>
          {WORDS.map((w) => <React.Fragment key={w}><dt>{w}</dt><dd>{DEFINITIONS[w]}</dd></React.Fragment>)}
        </dl>
      </details>
    </section>
  );
}
