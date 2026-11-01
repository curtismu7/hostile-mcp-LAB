import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getGatewayConfig, runGateway } from "../lib/api.js";
import { Untrusted } from "../lib/Untrusted.jsx";
import StoryPanel from "../story/StoryPanel.jsx";
import GatewayDiagram from "./GatewayDiagram.jsx";
import { CLAIMS, TAG_TEXT } from "../data/gatewayClaims.js";
import WHY from "../data/whyItMatters.json";

// Entitlement-aware discovery and the aggregate policy cap, shown against the hostile server. The simulation runs in the
// server process (POST /api/gateway/run); this page edits the policy, shows the two listings side by side and walks the
// diagram. Every Ping product claim here is a release claim (2026-11-02), UNVERIFIED on our tenant, and there is no live path.
const MEMBERS = ["bank", "hostile"];
const STAGES = [["first", "Day one: the first list"], ["later", "The morning after: the next list"]];
const split = (t) => t.split(/[\s,]+/).filter(Boolean);
const told = (code) => code.replace(/_/g, " ");
const REASON = { "not-entitled": "not entitled", "over-cap": "over the cap", "not-in-toolfilter": "outside ToolFilter", "duplicate-in-member": "defined twice by the member", "invalid-name": "invalid name" };

export const initialEditor = (cfg, caller = "analyst") => ({
  caller, stage: "later", task: 2,
  aliases: { ...cfg.defaults.aliases },
  filterText: { bank: "", hostile: "" },
  reachable: { ...cfg.defaults.reachable },
  entitled: [...cfg.callers[caller].entitled],
  capOn: true,
  capAllow: [...cfg.defaults.capAllow],
});
export const requestFor = (ed, cfg) => ({
  stage: ed.stage, caller: ed.caller, task: cfg.tasks[ed.task],
  policy: {
    aliases: ed.aliases,
    toolFilter: Object.fromEntries(MEMBERS.map((k) => [k, split(ed.filterText[k]).length ? split(ed.filterText[k]) : null])),
    reachable: ed.reachable,
    entitled: ed.entitled,
    capAllow: ed.capOn ? ed.capAllow : null,
  },
});

const callsText = (victim) => (victim.calls.length ? victim.calls.map((c) => c.tool).join(", ") : "no call");
const toggle = (list, name) => (list.includes(name) ? list.filter((n) => n !== name) : [...list, name]);

function Tags({ tags }) {
  return <span className="claim-tags">{tags.map((t) => <span key={t} className="claim-tag" title={TAG_TEXT[t]}>{TAG_TEXT[t]}</span>)}</span>;
}

function Direct({ r }) {
  const d = r.direct;
  return (
    <section className="card col" aria-label="No gateway" data-testid="gw-direct">
      <h3>No gateway: everything listed</h3>
      <p className="verdict deny" role="status" data-testid="gw-direct-count">{d.count} tools listed, bare names</p>
      <p>The client is connected to both servers and takes whatever each one lists. List #{r.listNumber}.</p>
      {d.collisions.length > 0 && <p className="small"><strong>Defined by more than one server:</strong> <code>{d.collisions.join(", ")}</code>. The last definition wins.</p>}
      {d.silentlyMissing.length > 0 && <p className="small" data-testid="gw-silent"><strong>Silently missing:</strong> {d.silentlyMissing.join(", ")}. The server is down and nothing says so.</p>}
      <details>
        <summary>All {d.count} names</summary>
        <ul className="small gw__names">{d.tools.map((t, i) => <li key={`${t.member}-${t.name}-${i}`}><code>{t.name}</code> <span className="muted">from {t.member}</span></li>)}</ul>
      </details>
      <h4>Could a call reach a server?</h4>
      <ul className="small">{d.attempts.map((a) => <li key={a.name}><code>{a.name}</code>: {a.reached ? "yes, nothing checks it" : "not offered"}</li>)}</ul>
      <h4>The call the victim would make</h4>
      <p data-testid="gw-direct-victim"><code>{callsText(d.victim)}</code></p>
    </section>
  );
}

function Audit({ g }) {
  return (
    <aside className="gw__audit" aria-labelledby="gw-audit-h" data-testid="gw-audit">
      <h4 id="gw-audit-h">Demo audit pane</h4>
      <p className="muted small">This is an administrator's view, shown here so you can see why. The caller is not shown it: a caller sees only the listed tools and, for a refused call, the words <code>not available</code>, the same for a hidden tool and one that does not exist (a lab reading; the release claim does not say).</p>
      <p className="small" data-testid="gw-audit-hidden"><strong>{g.hiddenCount}</strong> tools hidden from this caller.</p>
      <ul className="small">
        {g.members.map((m) => (
          <li key={m.alias}><code>{m.alias}</code>: {m.status === "ok" ? `${m.listed} of ${m.offered} offered tools listed` : "unreachable, nothing offered"}</li>
        ))}
      </ul>
      <p className="small">Why each probe call was refused:</p>
      <ul className="small" data-testid="gw-audit-reasons">
        {g.attempts.map((a) => <li key={a.name}><code>{a.name}</code>: {a.ok ? `forwarded to ${a.forwardedTo}` : (a.auditReason ? (REASON[a.auditReason] ?? told(a.auditReason)) : told(a.code))}</li>)}
      </ul>
      <p className="small" data-testid="gw-hops"><strong>{g.memberHops}</strong> of {g.attempts.length} calls reached a member.</p>
    </aside>
  );
}

function Via({ r }) {
  const g = r.gateway;
  return (
    <section className="card col" aria-label="Entitlement filter plus cap" data-testid="gw-gateway">
      <h3>Entitlement filter plus cap</h3>
      <p className="verdict ok" role="status" data-testid="gw-gateway-count">{g.count} tools listed</p>
      <ul className="gw__members small">
        {g.members.map((m) => (
          <li key={m.alias} data-testid={`gw-member-${m.alias}`}>
            <code>{m.alias}</code>{" "}
            {m.status === "ok" ? <span className="pill yes">reachable</span> : <span className="pill no">unreachable: reported, not dropped</span>}
          </li>
        ))}
      </ul>
      <h4>What the caller receives</h4>
      {g.tools.length === 0 ? <p className="muted">No tools.</p> : (
        <ul className="tools">
          {g.tools.map((t) => (
            <li key={t.name}>
              <p><code>{t.name}</code></p>
              <Untrusted text={t.description} block />
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">An entitled tool under the cap is delivered exactly as its server wrote it. The filter does not clean content.</p>
      <h4>Calls, checked again at the member hop</h4>
      <div className="table-wrap">
        <table className="gw__table" data-testid="gw-attempts">
          <thead><tr><th scope="col">Call</th><th scope="col">The caller is told</th><th scope="col">Where</th></tr></thead>
          <tbody>
            {g.attempts.map((a) => (
              <tr key={a.name}>
                <th scope="row"><code>{a.name}</code></th>
                <td>{a.ok ? `forwarded to ${a.forwardedTo}` : `refused: ${told(a.code)}`}</td>
                <td>{a.stage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {g.pin && (
        <p className="small" data-testid="gw-pin"><strong>Pinned client, list #{g.pin.approvedFromList} against list #{g.pin.checkedList}:</strong> {g.pin.changed.length ? `changed: ${g.pin.changed.join(", ")}. The gateway kept it listed; pinning is what noticed.` : "nothing changed."}</p>
      )}
      <h4>The call the victim would make</h4>
      <p data-testid="gw-gateway-victim"><code>{callsText(g.victim)}</code></p>
      <Audit g={g} />
    </section>
  );
}

export default function Gateway({ present, theme = "system" }) {
  const [cfg, setCfg] = useState(null);
  const [ed, setEd] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const seq = useRef(0);

  useEffect(() => { getGatewayConfig().then((c) => { setCfg(c); setEd(initialEditor(c)); }).catch((e) => setError(e.message)); }, []);

  const body = useMemo(() => (cfg && ed ? JSON.stringify(requestFor(ed, cfg)) : null), [cfg, ed]);
  useEffect(() => {
    if (!body) return undefined;
    const mine = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      runGateway(JSON.parse(body))
        .then((r) => { if (mine === seq.current) { setResult(r); setError(""); } })
        .catch((e) => { if (mine === seq.current) setError(e.message); })
        .finally(() => { if (mine === seq.current) setBusy(false); });
    }, 120);
    return () => clearTimeout(t);
  }, [body]);

  const set = useCallback((patch) => setEd((e) => ({ ...e, ...patch })), []);
  const reset = useCallback(() => { if (cfg) { setEd(initialEditor(cfg)); setResetToken((n) => n + 1); } }, [cfg]);
  const pickCaller = (caller) => set({ caller, entitled: [...cfg.callers[caller].entitled] });

  const rows = useMemo(() => (cfg && ed ? cfg.members.flatMap((m) => m.tools.map((tool) => ({ key: m.key, tool, name: `${ed.aliases[m.key]}__${tool}` }))) : []), [cfg, ed]);
  const outcomeOf = (row) => {
    if (!result) return "";
    const alias = result.members.find((m) => m.key === row.key).alias;
    const name = `${alias}__${row.tool}`;
    if (result.gateway.tools.some((t) => t.name === name)) return "listed";
    const h = result.gateway.hidden.find((x) => x.name === name);
    if (h) return `hidden: ${REASON[h.reason] ?? h.reason}`;
    if (result.gateway.unreachable.includes(alias)) return "member unreachable";
    return "not offered on this list";
  };

  if (!cfg || !ed) return <>{error ? <p role="alert" className="alert">Could not load the gateway page: {error}</p> : <p className="muted">Loading...</p>}</>;
  const ready = !!result && !busy;

  return (
    <>
      <StoryPanel mode="gateway" present={present} />
      <h2>One listing, checked twice</h2>
      <p className="lede">A gateway in front of both servers lists only the tools this caller is entitled to and the aggregate policy allows, prefixes every name with its server's alias, and asks the same question again when a call is forwarded. Edit the policy and watch the same hostile server through it. <strong>{cfg.status}.</strong> {cfg.mode}.</p>

      <div className="card controls gw__controls">
        <label>Caller
          <select value={ed.caller} onChange={(e) => pickCaller(e.target.value)}>
            {Object.entries(cfg.callers).map(([id, c]) => <option key={id} value={id}>{c.label}</option>)}
          </select>
        </label>
        <label>When
          <select value={ed.stage} onChange={(e) => set({ stage: e.target.value })}>
            {STAGES.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
          </select>
        </label>
        <label>Task
          <select value={ed.task} onChange={(e) => set({ task: Number(e.target.value) })}>
            {cfg.tasks.map((t, i) => <option key={t} value={i}>{t}</option>)}
          </select>
        </label>
        <span className="muted small" role="status" aria-live="polite" data-testid="gw-state">{busy ? "Running..." : result ? "Up to date" : ""}</span>
      </div>
      {error && <p role="alert" className="alert" data-testid="gw-error">{error}</p>}

      {result && (
        <div className="cols">
          <Direct r={result} />
          <Via r={result} />
        </div>
      )}

      <section className="card gw__editor" aria-labelledby="gw-editor-h">
        <h3 id="gw-editor-h">The policy you can edit</h3>
        <p className="muted small">Entitlements and the cap are written against the namespaced name, so renaming an alias without updating them hides that server's tools: it fails closed. An alias is a public label that appears in every tool name, so never type a secret into it. The Reset button under the diagram puts every field back.</p>
        <div className="controls">
          {MEMBERS.map((k) => (
            <fieldset key={k} className="gw__member">
              <legend>Server: {k} <span className="muted small">({cfg.members.find((m) => m.key === k).appRef})</span></legend>
              <label>Alias
                <input value={ed.aliases[k]} maxLength={24} aria-label={`Alias for ${k}`} onChange={(e) => set({ aliases: { ...ed.aliases, [k]: e.target.value } })} />
              </label>
              <label>ToolFilter (names, comma separated; empty = none)
                <input value={ed.filterText[k]} aria-label={`ToolFilter for ${k}`} onChange={(e) => set({ filterText: { ...ed.filterText, [k]: e.target.value } })} />
              </label>
              <label className="gw__check">
                <input type="checkbox" checked={ed.reachable[k]} onChange={(e) => set({ reachable: { ...ed.reachable, [k]: e.target.checked } })} /> Reachable
              </label>
            </fieldset>
          ))}
          <label className="gw__check">
            <input type="checkbox" checked={ed.capOn} onChange={(e) => set({ capOn: e.target.checked })} /> Aggregate policy cap on
          </label>
        </div>
        <div className="table-wrap">
          <table className="gw__table" data-testid="gw-policy">
            <thead><tr><th scope="col">Tool</th><th scope="col">Entitled</th><th scope="col">Cap allows</th><th scope="col">Outcome (demo audit view)</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.key}-${row.tool}`}>
                  <th scope="row"><code>{row.name}</code></th>
                  <td><input type="checkbox" aria-label={`Entitled: ${row.name}`} checked={ed.entitled.includes(row.name)} onChange={() => set({ entitled: toggle(ed.entitled, row.name) })} /></td>
                  <td><input type="checkbox" aria-label={`Cap allows: ${row.name}`} disabled={!ed.capOn} checked={ed.capAllow.includes(row.name)} onChange={() => set({ capAllow: toggle(ed.capAllow, row.name) })} /></td>
                  <td>{outcomeOf(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {result && <p className="muted small" data-testid="gw-ignored">{result.policy.ignoredEntries} policy entries match no tool and are ignored.</p>}
      </section>

      <GatewayDiagram result={result} ready={ready} resetToken={resetToken} onReset={reset} theme={theme} />

      <section className="card" aria-labelledby="gw-why-h" data-testid="gw-why">
        <h3 id="gw-why-h">Why it matters <span className="pill partial">Ping claims, UNVERIFIED on our tenant</span></h3>
        <p className="muted small">{WHY.status}</p>
        {WHY.rows.map((r) => (
          <div key={r.slide}>
            <h4>{r.feature} (slide {r.slide})</h4>
            <dl className="gw__why">
              <dt>Challenge</dt><dd>{r.challenge}</dd>
              <dt>Technical</dt><dd>{r.technical}</dd>
              <dt>Business</dt><dd>{r.business}</dd>
            </dl>
          </div>
        ))}
      </section>

      <section className="card" aria-labelledby="gw-claims-h" data-testid="gw-claims">
        <h3 id="gw-claims-h">What is real, what is claimed, what we invented</h3>
        <ul className="gw__claims">
          {CLAIMS.map((c) => <li key={c.id}>{c.text} <Tags tags={c.tags} /></li>)}
        </ul>
      </section>
    </>
  );
}
