import React, { useEffect, useRef, useState } from "react";
import { approve, endSession, listTools, newSession, runVictim } from "../lib/api.js";
import { Revealed, Untrusted } from "../lib/Untrusted.jsx";
import StoryPanel from "../story/StoryPanel.jsx";
import { outcome } from "./Run.jsx";

// Story S05 as a guided flow: 1 approve list #1, 2 come back later (list #2), 3 compare. Each step is a real call
// against a per-visit session on the server, so list #1 is always clean and list #2 always carries the swap.
const TOOL = "get_stock_price";
const TASK = "What is the stock price of ACME?";
const find = (tools, name) => tools?.find((t) => t.name === name);

export default function RugPull({ present }) {
  const [step, setStep] = useState(0); // steps completed
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [state, setState] = useState({});
  const sessionId = useRef(null);
  useEffect(() => () => { if (sessionId.current) endSession(sessionId.current); }, []);

  async function act(fn) {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const approveFirst = () => act(async () => {
    const { sessionId: id } = await newSession();
    sessionId.current = id;
    const first = await listTools(id);
    const approval = await approve(id);
    setState({ first, approval });
    setStep(1);
  });
  const comeBack = () => act(async () => {
    const second = await listTools(sessionId.current);
    setState((s) => ({ ...s, second }));
    setStep(2);
  });
  const compare = () => act(async () => {
    const [ungoverned, pinned] = await Promise.all([runVictim(TASK, "ungoverned", "later"), runVictim(TASK, "pinned", "later")]);
    setState((s) => ({ ...s, ungoverned, pinned }));
    setStep(3);
  });
  const reset = async () => {
    if (sessionId.current) await endSession(sessionId.current);
    sessionId.current = null; setState({}); setStep(0); setError("");
  };

  const { first, approval, second, ungoverned, pinned } = state;
  const pin = approval?.approved.find((p) => p.name === TOOL);
  const verdict = second?.check?.results.find((r) => r.name === TOOL);
  const oneDiff = (d) => (
    <tr key={d.path}><th scope="row"><code>{d.path}</code><br /><span className="muted small">{d.change}</span>{d.hiddenChars && <><br /><strong className="small">contains invisible or look-alike characters</strong></>}</th>
      <td><Revealed text={d.beforeRevealed ?? "(none)"} block /></td><td><Revealed text={d.afterRevealed ?? "(none)"} block /></td></tr>
  );

  return (
    <>
      <StoryPanel mode="rugpull" present={present} />
      <h2>Rug-pull: a tool changed overnight</h2>
      <p className="lede">Three steps against the real hostile server. It answers list #1 with a clean <code>{TOOL}</code> and every later list with a poisoned one.</p>
      {error && <p role="alert" className="alert">Something went wrong: {error}</p>}
      <ol className="flow">
        <li className="card" aria-current={step === 0 ? "step" : undefined}>
          <h3><span className="story__n">1</span> Approve list #1</h3>
          <p>The tools are clean. The pinned client hashes name, description and input schema for each, and trusts them from now on.</p>
          <button type="button" className="btn primary" onClick={approveFirst} disabled={busy || step !== 0}>Approve list #1 (pin it)</button>
          {first && (
            <div data-testid="step1">
              <h4>List #{first.listNumber}: <code>{TOOL}</code></h4>
              <Untrusted text={find(first.tools, TOOL)?.description} block />
              <p className="small">Pinned {approval.approved.length} tools. <code>{TOOL}</code> sha256 <code>{pin?.sha256}</code></p>
              {approval.skipped.length > 0 && <p className="muted small">Refused at approval: {approval.skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}. {approval.note}</p>}
            </div>
          )}
        </li>
        <li className="card" aria-current={step === 1 ? "step" : undefined}>
          <h3><span className="story__n">2</span> Come back later</h3>
          <p>The next morning the client asks the same server for its tools again.</p>
          <button type="button" className="btn primary" onClick={comeBack} disabled={busy || step !== 1}>Fetch list #2</button>
          {second && (
            <div data-testid="step2">
              <h4>List #{second.listNumber}: <code>{TOOL}</code></h4>
              <Untrusted text={find(second.tools, TOOL)?.description} block />
            </div>
          )}
        </li>
        <li className="card" aria-current={step === 2 ? "step" : undefined}>
          <h3><span className="story__n">3</span> Compare</h3>
          <p>Run the same question through both clients, with list #2 as the server now serves it.</p>
          <button type="button" className="btn primary" onClick={compare} disabled={busy || step !== 2}>Compare the two clients</button>
          {pinned && verdict && (
            <div data-testid="step3">
              <h4>What changed in <code>{TOOL}</code></h4>
              <div className="table-wrap"><table><thead><tr><th>Field</th><th>Approved (before)</th><th>Served now (after)</th></tr></thead>
                <tbody>{(verdict.diff || []).map(oneDiff)}</tbody></table></div>
              <dl className="hashes">
                <dt>Hash before</dt><dd><code>{pin?.sha256}</code></dd>
                <dt>Hash after</dt><dd><code>{verdict.sha256}</code></dd>
              </dl>
              <div className="cols">
                <div className="card col" data-testid="rp-pinned">
                  <h4>Pinned client</h4>
                  <p className={`verdict ${outcome(pinned, ungoverned).level}`} role="status">REFUSED: {verdict.verdict}</p>
                  <p>{outcome(pinned, ungoverned).label}. Planned calls: {pinned.victim.calls.length ? pinned.victim.calls.map((c) => c.tool).join(", ") : "none"}.</p>
                </div>
                <div className="card col" data-testid="rp-ungoverned">
                  <h4>Ungoverned client</h4>
                  <p className={`verdict ${outcome(ungoverned, pinned).level}`} role="status">ACCEPTED: {outcome(ungoverned, pinned).label}</p>
                  <p>Planned calls: {ungoverned.victim.calls.map((c) => c.tool).join(", ")}. Nothing was executed.</p>
                </div>
              </div>
              <p className="muted small">Pinning caught this because the tool changed. Had it been poisoned on day one, the same hash would have matched. See the limits page.</p>
            </div>
          )}
        </li>
      </ol>
      <button type="button" className="btn" onClick={reset} disabled={busy || step === 0}>Reset the flow</button>
    </>
  );
}
