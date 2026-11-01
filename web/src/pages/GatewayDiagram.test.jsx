import React, { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

// jsdom cannot drag, so ReactFlow is swapped for a stand-in that shows each node's position and has a button that sends
// the same position change ReactFlow sends when a box is dragged. What is under test is the page's own bookkeeping:
// a drag is kept, per view, and Reset puts every box back where it started. The real drag is in scripts/e2e.mjs.
vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ReactFlow: ({ nodes, onNodesChange, children, autoPanOnNodeDrag }) => (
      <div data-testid="rf" data-autopan={String(autoPanOnNodeDrag)}>
        {nodes.map((n) => <div key={n.id} data-testid={`node-${n.id}`} data-x={n.position.x} data-y={n.position.y}>{n.data.title}</div>)}
        <button type="button" onClick={() => onNodesChange([{ type: "position", id: nodes.some((n) => n.id === "gw") ? "gw" : "caller", position: { x: 111, y: 222 }, dragging: false }])}>drag a box</button>
        {children}
      </div>
    ),
    Background: () => null,
    Controls: () => null,
  };
});
import GatewayDiagram from "./GatewayDiagram.jsx";

afterEach(cleanup);
function Harness() {
  const [token, setToken] = useState(0);
  return <GatewayDiagram result={null} ready={false} resetToken={token} onReset={() => setToken((n) => n + 1)} />;
}
const at = (id) => { const n = screen.getByTestId(`node-${id}`); return [Number(n.dataset.x), Number(n.dataset.y)]; };

test("a drag is kept, and Reset puts the box back where it started", async () => {
  render(<Harness />);
  expect(at("gw")).toEqual([330, 110]);
  await userEvent.click(screen.getByRole("button", { name: "drag a box" }));
  expect(at("gw")).toEqual([111, 222]);
  expect(at("bank")).toEqual([0, 0]); // negative control: only the dragged box moved
  await userEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(at("gw")).toEqual([330, 110]);
});

test("each view keeps its own drag, and Reset restores both views", async () => {
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "drag a box" }));
  await userEvent.selectOptions(screen.getByLabelText("View"), "direct");
  expect(at("caller")).toEqual([330, 110]); // the direct view was not moved by a drag in the other view
  await userEvent.click(screen.getByRole("button", { name: "drag a box" }));
  expect(at("caller")).toEqual([111, 222]);
  await userEvent.selectOptions(screen.getByLabelText("View"), "gateway");
  expect(at("gw")).toEqual([111, 222]); // the first drag is still there after switching away and back
  expect(at("caller")).toEqual([990, 110]); // and the drag of the direct view's caller did not move the gateway view's caller
  await userEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(at("gw")).toEqual([330, 110]);
  await userEvent.selectOptions(screen.getByLabelText("View"), "direct");
  expect(at("caller")).toEqual([330, 110]);
});

test("dragging a box does not pan the view: the canvas is told not to autopan, so a drag near the edge cannot push a label out of view", () => {
  render(<Harness />);
  expect(screen.getByTestId("rf").dataset.autopan).toBe("false");
});
