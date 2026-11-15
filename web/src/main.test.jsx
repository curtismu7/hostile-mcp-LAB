import { screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { catalog, mockFetch } from "./test/fixtures.js";

// main.jsx is the real start of the page. Each test loads it fresh (new module state, so the JsonPane view starts unset)
// into a fresh #root on the Diagram page, whose "On the wire" panel shows JSON panes on load. main.jsx renders with its own
// (fresh) React, outside testing-library's act(), so this file turns the act environment off as a browser would have it.
let actEnv;
beforeEach(() => {
  actEnv = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  window.location.hash = "#/diagram";
  vi.stubGlobal("fetch", vi.fn(mockFetch({ "GET /api/catalog": catalog })));
});
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; globalThis.IS_REACT_ACT_ENVIRONMENT = actEnv; });

test("on first load (no saved choice) the JSON panes open on the JSON view, not Form", async () => {
  await import("./main.jsx");
  const box = await screen.findByTestId("wire-response-body-box");
  expect(box).toHaveAttribute("data-view", "raw");
  expect(screen.getByTestId("wire-response-body-raw")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("wire-response-body-formatted")).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByTestId("wire-request-body")).toHaveTextContent('"method": "tools/list"');
});

test("a visitor's saved Form choice still wins over the lab's JSON default", async () => {
  localStorage.setItem("aag.json.view", "form");
  await import("./main.jsx");
  const box = await screen.findByTestId("wire-response-body-box");
  expect(box).toHaveAttribute("data-view", "form");
});
