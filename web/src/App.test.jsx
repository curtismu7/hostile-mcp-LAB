import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App, { PAGES } from "./App.jsx";
import { catalog, mockFetch } from "./test/fixtures.js";

beforeEach(() => { window.location.hash = ""; localStorage.clear(); vi.stubGlobal("fetch", vi.fn(mockFetch({ "GET /api/catalog": catalog }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("the hostile-server banner is on screen on every page", async () => {
  render(<App />);
  for (const [id, label] of PAGES) {
    await userEvent.click(screen.getByRole("link", { name: label }));
    expect(screen.getByTestId("banner")).toHaveTextContent(/deliberately hostile/i);
    expect(screen.getByTestId("banner")).toHaveTextContent(/inert/i);
    expect(screen.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    expect(window.location.hash).toBe(`#/${id}`);
  }
});

test("the release-claim banner is on every page, and stays in presenter mode", async () => {
  render(<App />);
  const claim = /Ping release claim \(2026-11-02\), UNVERIFIED on our tenant/;
  const check = () => {
    expect(screen.getByTestId("claim-banner")).toHaveTextContent(claim);
    expect(screen.getByTestId("claim-banner")).toHaveTextContent(/no live mode/);
    expect(screen.getByTestId("claim-banner")).not.toHaveAttribute("data-admin-only");
  };
  for (const [, label] of PAGES) { await userEvent.click(screen.getByRole("link", { name: label })); check(); }
  await userEvent.click(screen.getByRole("button", { name: "Present" }));
  expect(document.documentElement.dataset.present).toBe("1");
  for (const [, label] of PAGES) { await userEvent.click(screen.getByRole("link", { name: label })); check(); }
  expect(PAGES.map(([id]) => id)).toContain("gateway");
});

test("a skip link is the first tab stop, then the nav in order, then the toolbar; activating it focuses the main region", async () => {
  render(<App />);
  const user = userEvent.setup();
  const order = [];
  for (let i = 0; i < 8; i++) { await user.tab(); order.push(document.activeElement.textContent); }
  expect(order).toEqual(["Skip to content", ...PAGES.map(([, l]) => l), "Present", "Theme"].slice(0, 8));
  await user.click(screen.getByRole("link", { name: "Skip to content" }));
  expect(document.activeElement).toBe(document.getElementById("main"));
  expect(window.location.hash).toBe("");
});

test("the presenter toggle and the theme button set their flags on the document", async () => {
  render(<App />);
  await userEvent.click(screen.getByRole("button", { name: "Present" }));
  expect(document.documentElement.dataset.present).toBe("1");
  await userEvent.click(screen.getByRole("button", { name: "Present" }));
  expect(document.documentElement.dataset.present).toBeUndefined();
  await userEvent.selectOptions(screen.getByTestId("theme"), "light");
  expect(document.documentElement.dataset.theme).toBe("light");
  await userEvent.selectOptions(screen.getByTestId("theme"), "dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
});

test("the hosted-mock banner shows only when /api/health reports mock-only", async () => {
  vi.stubGlobal("fetch", vi.fn(mockFetch({ "GET /api/catalog": catalog, "GET /api/health": { mode: "mock-only" } })));
  render(<App />);
  expect(await screen.findByTestId("mock-banner")).toHaveTextContent("Hosted, simulated: sample data only, nothing leaves this server");
  cleanup();
  vi.stubGlobal("fetch", vi.fn(mockFetch({ "GET /api/catalog": catalog, "GET /api/health": { state: "ready" } })));
  render(<App />);
  await screen.findByTestId("banner");
  expect(screen.queryByTestId("mock-banner")).toBeNull();
});
