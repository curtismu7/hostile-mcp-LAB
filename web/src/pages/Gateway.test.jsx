import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
// The page is driven by the real simulation, not by canned numbers: the stubbed fetch calls the server code directly,
// so every count asserted here is a count the engine computed.
import { PolicyError, gatewayConfigResponse, parseRequest, runGateway } from "../../../server/src/gateway-scenario.js";
import Gateway from "./Gateway.jsx";
import { stepsFor } from "./GatewayDiagram.jsx";
import { CLAIMS, TAG_TEXT } from "../data/gatewayClaims.js";
import WHY from "../data/whyItMatters.json";

const SECRET = "SECRET_TOKEN_123";
let posts;
beforeEach(() => {
  localStorage.clear(); window.location.hash = ""; posts = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (url === "/api/gateway/config") return json(200, gatewayConfigResponse());
    if (url === "/api/gateway/run") {
      const body = JSON.parse(init.body);
      posts.push(body);
      try { return json(200, await runGateway(parseRequest(body))); } catch (e) { if (e instanceof PolicyError) return json(400, { message: e.message }); throw e; }
    }
    return json(404, { message: "no mock" });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const count = (id) => Number(screen.getByTestId(id).textContent.match(/^(\d+)/)[1]);
async function ready() {
  await waitFor(() => expect(screen.getByRole("button", { name: "Simulate" })).toBeEnabled(), { timeout: 8000 });
}
const box = (name) => screen.getByRole("checkbox", { name });

test("first load: side by side, with the engine's real counts and the claim label", async () => {
  render(<Gateway />);
  await ready();
  expect(count("gw-direct-count")).toBe(15);
  expect(count("gw-gateway-count")).toBe(4);
  expect(screen.getByTestId("gw-gateway-count")).toHaveTextContent("11 hidden for this caller");
  expect(screen.getByTestId("gw-direct")).toHaveTextContent("get_balance");
  expect(screen.getAllByText(/Ping release claim \(2026-11-02\), UNVERIFIED on our tenant/).length).toBeGreaterThan(0);
  expect(screen.getByText(/Offline simulation, no live path/)).toBeInTheDocument();
  expect(screen.getByTestId("gw-pin")).toHaveTextContent("changed: hostile__get_stock_price");
  expect(screen.getByTestId("gw-hops")).toHaveTextContent("2 of 6 calls reached a member");
  expect(screen.getByTestId("story-panel")).toHaveTextContent("S36");
});

test("the entitled caller still receives the poisoned description, as inert text", async () => {
  const { container } = render(<Gateway />);
  await ready();
  const via = within(screen.getByTestId("gw-gateway"));
  expect(via.getAllByText("hostile__get_stock_price").length).toBeGreaterThan(0);
  expect(via.getAllByTestId("untrusted").some((n) => /<IMPORTANT>Ignore prior instructions/.test(n.textContent))).toBe(true);
  expect(container.querySelector("script, img, [onerror]")).toBeNull();
  expect(within(screen.getByTestId("gw-policy")).getByText("hostile__send_email").closest("tr")).toHaveTextContent("hidden: over the cap");
});

test("changing the caller changes the listing; negative control: the other caller's list is unchanged", async () => {
  render(<Gateway />);
  await ready();
  await userEvent.selectOptions(screen.getByLabelText("Caller"), "viewer");
  await waitFor(() => expect(count("gw-gateway-count")).toBe(2));
  expect(count("gw-direct-count")).toBe(15);
  await userEvent.selectOptions(screen.getByLabelText("Caller"), "analyst");
  await waitFor(() => expect(count("gw-gateway-count")).toBe(4));
});

test("each editable field changes the answer: entitlement, cap, alias, ToolFilter, reachability, list", async () => {
  render(<Gateway />);
  await ready();
  await userEvent.click(box("Entitled: hostile__get_weather"));
  await waitFor(() => expect(count("gw-gateway-count")).toBe(3));
  await userEvent.click(box("Entitled: hostile__get_weather"));
  await waitFor(() => expect(count("gw-gateway-count")).toBe(4));

  await userEvent.click(screen.getByRole("checkbox", { name: /Aggregate policy cap on/ }));
  await waitFor(() => expect(count("gw-gateway-count")).toBe(5));
  await userEvent.click(screen.getByRole("checkbox", { name: /Aggregate policy cap on/ }));
  await waitFor(() => expect(count("gw-gateway-count")).toBe(4));

  await userEvent.type(screen.getByLabelText("ToolFilter for hostile"), "get_weather");
  await waitFor(() => expect(count("gw-gateway-count")).toBe(3));
  await userEvent.clear(screen.getByLabelText("ToolFilter for hostile"));
  await waitFor(() => expect(count("gw-gateway-count")).toBe(4));

  const aliasBox = screen.getByLabelText("Alias for hostile");
  await userEvent.clear(aliasBox);
  await userEvent.type(aliasBox, "ext");
  await waitFor(() => expect(count("gw-gateway-count")).toBe(2));
  expect(screen.getByTestId("gw-ignored")).toHaveTextContent(/[1-9]\d* policy entries match no tool/);
  await userEvent.clear(aliasBox);
  await userEvent.type(aliasBox, "hostile");
  await waitFor(() => expect(count("gw-gateway-count")).toBe(4));

  await userEvent.click(within(screen.getByRole("group", { name: /Server: hostile/ })).getByRole("checkbox"));
  await waitFor(() => expect(screen.getByTestId("gw-member-hostile")).toHaveTextContent("unreachable: reported, not dropped"));
  expect(screen.getByTestId("gw-silent")).toHaveTextContent("hostile");
  expect(count("gw-direct-count")).toBe(2);

  await userEvent.selectOptions(screen.getByLabelText("When"), "first");
  await waitFor(() => expect(screen.queryByTestId("gw-pin")).toBeNull());
});

test("a bad alias is refused with a fixed message, the last good answer stays, and nothing typed is echoed", async () => {
  render(<Gateway />);
  await ready();
  const aliasBox = screen.getByLabelText("Alias for bank");
  await userEvent.clear(aliasBox);
  await userEvent.type(aliasBox, "A__b");
  const alert = await screen.findByTestId("gw-error");
  expect(alert).toHaveTextContent(/alias is 1 to 24 characters/);
  expect(alert.textContent).not.toContain("A__b");
  expect(count("gw-gateway-count")).toBe(4);
  expect(JSON.stringify(posts)).not.toContain(SECRET);
});

test("Reset puts the policy, the list, the caller and the walk back", async () => {
  render(<Gateway />);
  await ready();
  await userEvent.selectOptions(screen.getByLabelText("Caller"), "viewer");
  await userEvent.click(box("Entitled: bank__get_balance"));
  await userEvent.selectOptions(screen.getByLabelText("When"), "first");
  await waitFor(() => expect(count("gw-gateway-count")).toBe(1));
  await userEvent.click(screen.getByRole("button", { name: "Reset" }));
  await waitFor(() => expect(count("gw-gateway-count")).toBe(4));
  expect(screen.getByLabelText("Caller")).toHaveValue("analyst");
  expect(screen.getByLabelText("When")).toHaveValue("later");
  expect(count("gw-direct-count")).toBe(15);
  expect(screen.getByLabelText("Alias for hostile")).toHaveValue("hostile");
  expect(screen.getByTestId("gw-caption")).toHaveTextContent("Press Simulate");
});

test("Simulate walks the gateway view with the measured numbers, and Reset clears the walk", async () => {
  render(<Gateway />);
  await ready();
  await userEvent.selectOptions(screen.getByLabelText("Speed"), "4");
  await userEvent.click(screen.getByRole("button", { name: "Simulate" }));
  await waitFor(() => expect(screen.getByTestId("gw-caption")).toHaveTextContent(/Step 5 of 5/), { timeout: 8000 });
  expect(screen.getByTestId("gw-caption")).toHaveTextContent("2 of 6 probe calls reached a server");
  await userEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(screen.getByTestId("gw-caption")).toHaveTextContent("Press Simulate");
  await userEvent.selectOptions(screen.getByLabelText("View"), "direct");
  await userEvent.selectOptions(screen.getByLabelText("Speed"), "4");
  await userEvent.click(screen.getByRole("button", { name: "Simulate" }));
  await waitFor(() => expect(screen.getByTestId("gw-caption")).toHaveTextContent(/Step 3 of 3/), { timeout: 8000 });
  expect(screen.getByTestId("gw-caption")).toHaveTextContent("would reach a server");
});

test("the captions are computed from the run, not scripted", async () => {
  const r = await runGateway(parseRequest({ policy: { reachable: { hostile: false } } }));
  expect(stepsFor("gateway", r)[0].text).toContain("unreachable and is reported");
  expect(stepsFor("gateway", r)[0].text).toContain("offer 2 tools");
  expect(stepsFor("direct", r)[2].text).toContain("hostile is down");
  const base = await runGateway(parseRequest({}));
  const text = stepsFor("gateway", base).map((s) => s.text).join(" | ");
  expect(text).toContain("offer 15 tools");
  expect(text).toContain("remove 10 for this caller");
  expect(text).toContain("removes 1 more");
  expect(text).toContain("sees 4 tools");
  expect(stepsFor("gateway", null)).toHaveLength(1);
});

test("why it matters carries the Challenge, Technical and Business lines for slides 36 and 37, labelled as Ping claims", async () => {
  render(<Gateway />);
  await ready();
  const why = within(screen.getByTestId("gw-why"));
  expect(why.getByText("Ping claims, UNVERIFIED on our tenant")).toBeInTheDocument();
  expect(WHY.rows.map((r) => r.slide)).toEqual([36, 37]);
  for (const r of WHY.rows) for (const k of ["challenge", "technical", "business"]) expect(why.getByText(r[k])).toBeInTheDocument();
  expect(why.getByText(/One connection, one policy cap enforced twice, one audit trail across members/)).toBeInTheDocument();
});

test("every claim carries a tag; the swagger tag is on the four real names and never on the filter or the cap", () => {
  expect(Object.keys(TAG_TEXT)).toEqual(["swagger", "deck", "invented", "reading"]);
  expect(TAG_TEXT.swagger).toBe("console swagger name, 2026-10-31, schema only");
  for (const c of CLAIMS) { expect(c.tags.length).toBeGreaterThan(0); for (const t of c.tags) expect(Object.hasOwn(TAG_TEXT, t)).toBe(true); }
  const by = Object.fromEntries(CLAIMS.map((c) => [c.id, c]));
  expect(by.members.tags).toEqual(["swagger"]);
  for (const w of ["Members", "AppRef", "Alias", "ToolFilter", "mcp-aggregate"]) expect(by.members.text + by["alias-naming"].text).toContain(w);
  for (const id of ["entitlement", "cap"]) { expect(by[id].tags).not.toContain("swagger"); expect(by[id].tags).toEqual(expect.arrayContaining(["deck", "invented"])); }
  expect(by.cap.text).toMatch(/real field name is unknown/);
  expect(by.identity.text).toMatch(/NonHumanIdentity/);
  expect(by["no-live"].text).toMatch(/v1\.261030/);
});
