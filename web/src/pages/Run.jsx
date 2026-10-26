import React, { useState } from "react";
import { runVictim } from "../lib/api.js";
import { Untrusted, pretty } from "../lib/Untrusted.jsx";
import StoryPanel from "../story/StoryPanel.jsx";

// Benign tasks, each one exercising a different poison. The tasks are fixed so a run is deterministic.
export const TASKS = [
  { text: "What's the weather in Denver?", note: "description injection" },
  { text: "Search the docs for the vacation policy", note: "schema exfiltration sink" },
  { text: "Check my account balance", note: "tool shadowing" },
  { text: "What is the stock price of ACME?", note: "rug-pull (the next-morning list)" },
  { text: "Send an email to the team about lunch", note: "hidden bcc sink" },
  { text: "Verify my identity", note: "credential harvest" },
  { text: "Summarize my support ticket", note: "plain 'ignore previous instructions'" },
];
const STAGES = [["first", "Day one: the list as first approved"], ["later", "The morning after: the next list"]];

export function outcome(run, other) {
  if (run.summary.poisonLanded) return { id: "landed", label: "POISON LANDED", level: "deny" };
  if (run.mode === "pinned" && run.summary.withheldCount > 0 && other?.summary.poisonLanded) return { id: "blocked", label: "BLOCKED BY PIN", level: "ok" };
  return { id: "clean", label: "NO POISON LANDED", level: "ok" };
}

function explain(run, result) {
  const calls = run.victim.calls;
  const poisoned = calls.filter((c) => c.poison);
  if (result.id === "landed") {
    const first = poisoned[0];
    return run.mode === "pinned"
      ? `The pin did not help: this tool was already in the list that was approved, so its hash matched. ${first.reasons.find((r) => r.poison)?.text ?? ""}`
      : `Nothing checked the metadata, so the victim read it as trusted. ${first.reasons.find((r) => r.poison)?.text ?? ""}`;
  }
  if (result.id === "blocked") {
    const names = run.pinned.withheld.map((w) => `${w.name} (${w.verdict})`).join(", ");
    return `The pinned client compared the new list with what was approved and withheld: ${names}. The victim never read the changed text.`;
  }
  return "No poison reached the victim in this run. This does not mean the tool is safe, only that this task and stage did not trigger one.";
}

function ToolList({ run }) {
  const verdicts = Object.fromEntries((run.pinned?.results ?? []).map((r) => [r.name, r.verdict]));
  return (
    <details open>
      <summary>Tools the victim saw ({run.toolsSeen.length})</summary>
      <ul className="tools">
        {run.toolsSeen.map((t, i) => (
          <li key={`${t.name}-${i}`}>
            <p><code>{t.name}</code> <span className="muted small">from {t.source} · sha256 {t.sha256}</span>
              {t.source === "hostile" && verdicts[t.name] && <span className={`pill ${verdicts[t.name] === "ok" ? "yes" : "no"}`}>{verdicts[t.name]}</span>}</p>
            <Untrusted text={t.description} block />
            <details><summary className="small">input schema</summary><Untrusted text={pretty(t.inputSchema)} block /></details>
          </li>
        ))}
      </ul>
      {run.pinned?.withheld.length > 0 && (
        <p className="small" data-testid="withheld"><strong>Withheld before the victim:</strong> {run.pinned.withheld.map((w) => `${w.name} (${w.verdict})`).join(", ")}</p>
      )}
    </details>
  );
}

export function Column({ title, run, other }) {
  const result = outcome(run, other);
  return (
    <section className="card col" aria-label={title} data-testid={`col-${run.mode}`}>
      <h3>{title}</h3>
      <p className={`verdict ${result.level}`} role="status" data-testid={`result-${run.mode}`}>{result.label}</p>
      <p>{explain(run, result)}</p>
      <h4>The call it would make</h4>
      {run.victim.calls.length === 0 ? <p className="muted">No call.</p> : (
        <ol className="calls">
          {run.victim.calls.map((c, i) => (
            <li key={i} className={c.poison ? "poison-call" : undefined}>
              <code>{c.tool}</code> <Untrusted text={JSON.stringify(c.arguments)} />
              {c.poison && <span className="pill no">poison</span>}
              <ul className="small">{c.reasons.map((r, j) => <li key={j}><Untrusted text={r.text} /></li>)}</ul>
            </li>
          ))}
        </ol>
      )}
      <p className="muted small">Nothing was executed. {run.victim.executed ? "" : "The victim only returns the call as data."}</p>
      <ToolList run={run} />
      <details><summary>Trace</summary><ol className="small">{run.trace.map((s) => <li key={s.step}>{s.what}{s.detail ? `: ${s.detail}` : ""}</li>)}</ol></details>
    </section>
  );
}

function initial() {
  const q = new URLSearchParams((window.location.hash.split("?")[1] || ""));
  const task = Number(q.get("task"));
  return { task: Number.isInteger(task) && TASKS[task] ? task : 0, stage: STAGES.some(([id]) => id === q.get("stage")) ? q.get("stage") : "later" };
}

export default function Run({ present }) {
  const [{ task, stage }, setSel] = useState(initial);
  const [runs, setRuns] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function go() {
    setBusy(true); setError(""); setRuns(null);
    try {
      const [ungoverned, pinned] = await Promise.all([runVictim(TASKS[task].text, "ungoverned", stage), runVictim(TASKS[task].text, "pinned", stage)]);
      setRuns({ ungoverned, pinned });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <>
      <StoryPanel mode="run" present={present} />
      <h2>Run the victim</h2>
      <p className="lede">Same poisoned server, two clients. Pick a harmless task. The <abbr title="The assistant that reads the tool list and plans calls from it. Offline here, with no model.">victim</abbr> reads the tool list once through an <abbr title="A client that takes whatever the server sends, with no check.">ungoverned client</abbr>, which trusts it, and once through a <abbr title="A client that fingerprints each approved tool and refuses any tool whose fingerprint later changes.">pinned client</abbr>, which checks it first.</p>
      <form className="card controls" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <label>Task
          <select value={task} onChange={(e) => setSel((s) => ({ ...s, task: Number(e.target.value) }))}>
            {TASKS.map((t, i) => <option key={t.text} value={i}>{t.text} ({t.note})</option>)}
          </select>
        </label>
        <label>When
          <select value={stage} onChange={(e) => setSel((s) => ({ ...s, stage: e.target.value }))}>
            {STAGES.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
          </select>
        </label>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? "Running..." : "Run both clients"}</button>
      </form>
      {error && <p role="alert" className="alert">Could not run: {error}</p>}
      {runs && (
        <div className="cols">
          <Column title="Ungoverned client" run={runs.ungoverned} other={runs.pinned} />
          <Column title="Pinned client" run={runs.pinned} other={runs.ungoverned} />
        </div>
      )}
    </>
  );
}
