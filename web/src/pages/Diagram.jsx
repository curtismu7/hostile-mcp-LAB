import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Background, Controls, Handle, Position, ReactFlow, applyNodeChanges, MarkerType } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import StoryPanel from "../story/StoryPanel.jsx";

// MCP server -> client -> pin check -> victim -> tool call. Boxes are draggable; Simulate walks one run of the
// rug-pull, Reset puts everything back, the speed control sets the pace. The step caption under the diagram says in
// words what the picture shows, so the diagram is never the only carrier.
const START = [
  { id: "server", position: { x: 0, y: 110 }, data: { title: "Hostile MCP server", sub: "Serves the payloads. Never scores or blocks." } },
  { id: "client", position: { x: 280, y: 110 }, data: { title: "Client", sub: "Receives the tool list. Ungoverned: passes it on. Pinned: checks it first." } },
  { id: "pin", position: { x: 560, y: 110 }, data: { title: "Pin check", sub: "Fingerprints each tool (SHA-256 of name, description, schema) and compares it with the fingerprint recorded at approval." } },
  { id: "withheld", position: { x: 560, y: -80 }, data: { title: "Withheld", sub: "Changed or shadowed tool: not shown to the victim" } },
  { id: "victim", position: { x: 840, y: 110 }, data: { title: "Offline victim", sub: "Reads the tool list, plans calls. No model." } },
  { id: "call", position: { x: 1120, y: 110 }, data: { title: "Planned call", sub: "Inert stub. Never executed." } },
];
const EDGES = [
  { id: "e1", source: "server", target: "client", sourceHandle: "r", targetHandle: "l", label: "1 tools/list" },
  { id: "e2", source: "client", target: "pin", sourceHandle: "r", targetHandle: "l", label: "2 fingerprint check (pinned only)" },
  { id: "e3", source: "pin", target: "victim", sourceHandle: "r", targetHandle: "l", label: "3 tools that passed" },
  { id: "e3w", source: "pin", target: "withheld", sourceHandle: "t", targetHandle: "b", label: "3 changed: withheld" },
  { id: "e4", source: "victim", target: "call", sourceHandle: "r", targetHandle: "l", label: "4 plans a call" },
  { id: "e5", source: "client", target: "victim", sourceHandle: "b", targetHandle: "bt", label: "2 straight through (ungoverned)", dashed: true },
];
export const SCENARIOS = {
  ungoverned: {
    label: "Ungoverned client",
    steps: [
      { edges: ["e1"], nodes: ["server", "client"], text: "The client asks for tools/list and gets the poisoned get_stock_price description." },
      { edges: ["e5"], nodes: ["client", "victim"], text: "No pin check: the client hands the list straight to the victim." },
      { edges: ["e4"], nodes: ["victim", "call"], text: "POISON LANDED: the victim obeys the description and plans create_transfer. It is only planned; nothing runs." },
    ],
  },
  pinned: {
    label: "Pinned client",
    steps: [
      { edges: ["e1"], nodes: ["server", "client"], text: "The client asks for tools/list and gets the poisoned get_stock_price description." },
      { edges: ["e2"], nodes: ["client", "pin"], text: "The pin check hashes each tool and compares it with the hash recorded at approval." },
      { edges: ["e3w"], nodes: ["pin", "withheld"], text: "BLOCKED BY PIN: get_stock_price changed, so it is withheld along with its field diff." },
      { edges: ["e3"], nodes: ["pin", "victim"], text: "Only tools that passed reach the victim. It plans no poisoned call." },
    ],
  },
};
const SPEEDS = [["0.5", "0.5x"], ["1", "1x"], ["2", "2x"], ["4", "4x"]];
const BASE_MS = 1600;

function Box({ data }) {
  return (
    <div className={`fbox${data.on ? " on" : ""}${data.dim ? " dim" : ""}`}>
      <Handle id="l" type="target" position={Position.Left} />
      <Handle id="r" type="source" position={Position.Right} />
      <Handle id="t" type="source" position={Position.Top} />
      <Handle id="b" type="target" position={Position.Bottom} />
      <Handle id="bt" type="target" position={Position.Bottom} style={{ left: "75%" }} />
      <strong>{data.title}</strong>
      <span>{data.sub}</span>
    </div>
  );
}
const nodeTypes = { box: Box };

export default function Diagram({ present, theme = "system" }) {
  const [moved, setMoved] = useState(START);
  const [scenario, setScenario] = useState("pinned");
  const [speed, setSpeed] = useState("1");
  const [step, setStep] = useState(-1); // -1 = idle
  const [running, setRunning] = useState(false);
  const steps = SCENARIOS[scenario].steps;

  useEffect(() => {
    if (!running) return undefined;
    if (step >= steps.length - 1) { setRunning(false); return undefined; }
    const t = setTimeout(() => setStep((s) => s + 1), BASE_MS / Number(speed));
    return () => clearTimeout(t);
  }, [running, step, steps.length, speed]);

  const simulate = () => { setStep(0); setRunning(true); };
  const reset = () => { setRunning(false); setStep(-1); setMoved(START); };
  const pickScenario = (s) => { setScenario(s); setRunning(false); setStep(-1); };
  const onNodesChange = useCallback((changes) => setMoved((n) => applyNodeChanges(changes, n)), []);

  const cur = step >= 0 ? steps[step] : null;
  const nodes = useMemo(() => moved.map((n) => ({ ...n, type: "box", data: { ...n.data, on: !!cur?.nodes.includes(n.id), dim: !!cur && !cur.nodes.includes(n.id) } })), [moved, cur]);
  const edges = useMemo(() => EDGES.map(({ dashed, ...e }) => ({
    ...e,
    animated: !!cur?.edges.includes(e.id),
    className: `${cur?.edges.includes(e.id) ? "edge-on" : ""}${dashed ? " edge-dashed" : ""}`,
    markerEnd: { type: MarkerType.ArrowClosed },
  })), [cur]);

  return (
    <>
      <h2>How the pin sits in the path</h2>
      <p className="lede">MCP does not check tool descriptions for you, so a defence has to sit between the server and the assistant. The <abbr title="Records a fingerprint of each approved tool and refuses any tool whose fingerprint later changes.">pin check</abbr> is that defence. Drag any box. Simulate runs the rug-pull through the chosen client. Hover a dotted term for its meaning.</p>
      <div className="card controls">
        <label>Client
          <select value={scenario} onChange={(e) => pickScenario(e.target.value)}>
            {Object.entries(SCENARIOS).map(([id, s]) => <option key={id} value={id}>{s.label}</option>)}
          </select>
        </label>
        <label>Speed
          <select value={speed} onChange={(e) => setSpeed(e.target.value)}>
            {SPEEDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
        <button type="button" className="btn primary" onClick={simulate} disabled={running}>Simulate</button>
        <button type="button" className="btn" onClick={reset}>Reset</button>
      </div>
      <div className="flow-wrap" role="group" aria-label="Diagram of the MCP server, client, pin check, victim and planned call. Boxes can be dragged.">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} colorMode={theme}
          fitView fitViewOptions={{ padding: 0.12 }} nodesConnectable={false} proOptions={{ hideAttribution: true }} minZoom={0.2}>
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <p className="caption" role="status" aria-live="polite" data-testid="caption">
        {cur ? `Step ${step + 1} of ${steps.length}: ${cur.text}` : "Press Simulate to walk one run through the diagram."}
      </p>
      <StoryPanel mode="diagram" present={present} />
    </>
  );
}
