import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, Controls, Handle, Position, ReactFlow, applyNodeChanges, MarkerType } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// Where the entitlement filter and the aggregate policy cap sit between two servers and the caller. Boxes are draggable;
// Simulate walks the chosen view with the numbers from the last run, Reset (the page's Reset) puts positions, policy and
// step back. A Ping release claim (2026-11-02), UNVERIFIED on our tenant: this is a picture of the simulation, not of a product.
const START = [
  { id: "bank", position: { x: 0, y: 0 }, data: { title: "Server: bank", sub: "The trusted server. get_balance, get_statement." } },
  { id: "hostile", position: { x: 0, y: 220 }, data: { title: "Server: hostile", sub: "Poisoned tools, a rug-pull, a late tool." } },
  { id: "gw", position: { x: 330, y: 110 }, data: { title: "Aggregate gateway", sub: "One connection. Prefixes alias__tool." } },
  { id: "filter", position: { x: 660, y: -50 }, data: { title: "Entitlement filter", sub: "Keeps what this caller may see." } },
  { id: "cap", position: { x: 660, y: 110 }, data: { title: "Policy cap", sub: "Keeps what the aggregate allows." } },
  { id: "hidden", position: { x: 990, y: -50 }, data: { title: "Not listed", sub: "Hidden. The audit view says why." } },
  { id: "caller", position: { x: 990, y: 110 }, data: { title: "Caller", sub: "Sees the filtered list. Calls by alias__tool." } },
];
// Without a gateway there are only three boxes, so they sit close together.
const START_DIRECT = [
  START[0], START[1],
  { ...START[6], position: { x: 330, y: 110 } },
];
const EDGES = [
  { id: "g1", source: "bank", target: "gw", sourceHandle: "r", targetHandle: "l", label: "1 list, bank" },
  { id: "g2", source: "hostile", target: "gw", sourceHandle: "r", targetHandle: "l2", label: "1 list, hostile" },
  { id: "g3", source: "gw", target: "filter", sourceHandle: "r", targetHandle: "l", label: "2 prefixed" },
  { id: "g4", source: "filter", target: "cap", sourceHandle: "b", targetHandle: "tt", label: "3 entitled" },
  { id: "g5", source: "cap", target: "caller", sourceHandle: "r", targetHandle: "l", label: "4 listed" },
  { id: "g6", source: "filter", target: "hidden", sourceHandle: "r", targetHandle: "l", label: "removed" },
  { id: "g7", source: "caller", target: "gw", sourceHandle: "b", targetHandle: "bb", label: "5 call, checked again", dashed: true, kind: "smoothstep", pathOptions: { offset: 60 } },
  { id: "d1", source: "bank", target: "caller", sourceHandle: "r", targetHandle: "l", label: "1 list, bank" },
  { id: "d2", source: "hostile", target: "caller", sourceHandle: "r", targetHandle: "l2", label: "1 list, hostile" },
];
const FIT = { padding: 0.12, minZoom: 0.8 };
const SPEEDS = [["0.5", "0.5x"], ["1", "1x"], ["2", "2x"], ["4", "4x"]];
const BASE_MS = 1600;
const count = (list, reason) => list.filter((h) => h.reason === reason).length;

export const VIEWS = {
  direct: "No gateway",
  gateway: "Entitlement filter plus cap",
};

// Captions use the numbers of the last run, so the walk shows what was measured, not a script.
export function stepsFor(view, r) {
  if (!r) return [{ edges: [], nodes: [], text: "Waiting for the first run." }];
  const d = r.direct;
  const g = r.gateway;
  if (view === "direct") {
    return [
      { edges: ["d1", "d2"], nodes: ["bank", "hostile", "caller"], text: `Both servers answer tools/list straight to the client: ${d.count} tools, bare names${d.collisions.length ? `, and ${d.collisions.join(", ")} is defined twice` : ""}.` },
      { edges: ["d2"], nodes: ["hostile", "caller"], text: `The last definition of a name wins, so the victim plans: ${d.victim.calls.length ? d.victim.calls.map((c) => c.tool).join(", ") : "no call"}.` },
      { edges: ["d2"], nodes: ["hostile", "caller"], text: d.silentlyMissing.length ? `${d.silentlyMissing.join(", ")} is down and its tools are simply absent. Nothing says so.` : `Nothing checks a call: ${d.attempts.filter((a) => a.reached).map((a) => a.name).join(", ") || "none of the probe calls"} would reach a server.` },
    ];
  }
  const a = g.audit;
  const offered = a.members.filter((m) => m.status === "ok").reduce((n, m) => n + m.offered, 0);
  const byFilter = count(a.hidden, "not-entitled") + count(a.hidden, "not-in-toolfilter");
  return [
    { edges: ["g1", "g2"], nodes: ["bank", "hostile", "gw"], text: `One connection to the gateway. The servers offer ${offered} tools in all${g.unreachable.length ? `; ${g.unreachable.join(", ")} is unreachable and is reported` : ""}.` },
    { edges: ["g3", "g6"], nodes: ["gw", "filter", "hidden"], text: `Names get their alias prefix. The entitlement filter and ToolFilter remove ${byFilter} for this caller.` },
    { edges: ["g4", "g6"], nodes: ["filter", "cap", "hidden"], text: `The policy cap removes ${count(a.hidden, "over-cap")} more that the caller is entitled to but the aggregate does not allow.` },
    { edges: ["g5"], nodes: ["cap", "caller"], text: `The caller sees ${g.count} tools: ${g.tools.map((t) => t.name).join(", ") || "none"}.` },
    { edges: ["g7"], nodes: ["caller", "gw"], text: `The same decision runs again at the member hop: ${a.memberHops} of ${g.attempts.length} probe calls reached a server.` },
  ];
}

function Box({ data }) {
  return (
    <div className={`fbox${data.on ? " on" : ""}${data.dim ? " dim" : ""}`}>
      <Handle id="l" type="target" position={Position.Left} />
      <Handle id="l2" type="target" position={Position.Left} style={{ top: "75%" }} />
      <Handle id="r" type="source" position={Position.Right} />
      <Handle id="t" type="source" position={Position.Top} />
      <Handle id="b" type="source" position={Position.Bottom} />
      <Handle id="tt" type="target" position={Position.Top} />
      <Handle id="bb" type="target" position={Position.Bottom} style={{ left: "30%" }} />
      <Handle id="bd" type="target" position={Position.Bottom} style={{ left: "70%" }} />
      <strong>{data.title}</strong>
      <span>{data.sub}</span>
    </div>
  );
}
const nodeTypes = { box: Box };

export default function GatewayDiagram({ result, ready, resetToken, onReset, theme = "system" }) {
  const [placed, setPlaced] = useState({ gateway: START, direct: START_DIRECT });
  const [view, setView] = useState("gateway");
  const [speed, setSpeed] = useState("1");
  const [step, setStep] = useState(-1);
  const [running, setRunning] = useState(false);
  const steps = useMemo(() => stepsFor(view, result), [view, result]);
  const cur = step >= 0 ? steps[Math.min(step, steps.length - 1)] : null;

  useEffect(() => {
    if (!running) return undefined;
    if (step >= steps.length - 1) { setRunning(false); return undefined; }
    const t = setTimeout(() => setStep((s) => s + 1), BASE_MS / Number(speed));
    return () => clearTimeout(t);
  }, [running, step, steps.length, speed]);

  // The page's Reset: positions, step and the running walk go back to the start.
  const flow = useRef(null);
  useEffect(() => {
    setPlaced({ gateway: START, direct: START_DIRECT }); setStep(-1); setRunning(false);
    const t = setTimeout(() => flow.current?.fitView(FIT), 50); // autopan during a drag can move the view too
    return () => clearTimeout(t);
  }, [resetToken]);

  const simulate = () => { setStep(0); setRunning(true); };
  const pickView = (v) => { setView(v); setRunning(false); setStep(-1); };
  const onNodesChange = useCallback((changes) => setPlaced((p) => ({ ...p, [view]: applyNodeChanges(changes, p[view]) })), [view]);

  const moved = placed[view];
  const nodes = useMemo(() => moved.map((n) => ({ ...n, type: "box", data: { ...n.data, ...(view === "direct" && n.id === "caller" ? { sub: "Gets every tool each server lists, under bare names." } : {}), on: !!cur?.nodes.includes(n.id), dim: !!cur && !cur.nodes.includes(n.id) } })), [moved, cur, view]);
  const edges = useMemo(() => EDGES
    .filter((e) => (view === "direct" ? e.id.startsWith("d") : e.id.startsWith("g")))
    .map(({ dashed, kind, ...e }) => ({
      ...e,
      type: kind,
      animated: !!cur?.edges.includes(e.id),
      className: `${cur?.edges.includes(e.id) ? "edge-on" : ""}${dashed ? " edge-dashed" : ""}`,
      markerEnd: { type: MarkerType.ArrowClosed },
    })), [cur, view]);

  return (
    <section className="card gw__diagram" aria-labelledby="gw-diagram-h" data-testid="gw-diagram">
      <h3 id="gw-diagram-h">Where the two checks sit</h3>
      <p className="muted small">Drag any box (on a phone, drag the background to pan). Simulate walks the chosen view with the numbers from the last run. Reset puts the policy, the boxes and the walk back to the start. The captions narrate with the demo audit numbers; the caller is not shown them.</p>
      <div className="controls">
        <label>View
          <select value={view} onChange={(e) => pickView(e.target.value)}>
            {Object.entries(VIEWS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label>Speed
          <select value={speed} onChange={(e) => setSpeed(e.target.value)}>
            {SPEEDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
        <button type="button" className="btn primary" onClick={simulate} disabled={!ready || running}>Simulate</button>
        <button type="button" className="btn" onClick={onReset}>Reset</button>
      </div>
      <div className="flow-wrap" role="group" aria-label="Diagram of two servers, the aggregate gateway, the entitlement filter, the policy cap and the caller. Boxes can be dragged.">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} colorMode={theme}
          fitView fitViewOptions={FIT} onInit={(i) => { flow.current = i; }} nodesConnectable={false} proOptions={{ hideAttribution: true }} minZoom={0.2} key={view}>
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <p className="caption" role="status" aria-live="polite" data-testid="gw-caption">
        {cur ? `Step ${step + 1} of ${steps.length}: ${cur.text}` : "Press Simulate to walk one run through the diagram."}
      </p>
    </section>
  );
}
