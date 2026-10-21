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

test("the presenter toggle and the theme button set their flags on the document", async () => {
  render(<App />);
  await userEvent.click(screen.getByRole("button", { name: "Present" }));
  expect(document.documentElement.dataset.present).toBe("1");
  await userEvent.click(screen.getByRole("button", { name: "Present" }));
  expect(document.documentElement.dataset.present).toBeUndefined();
  await userEvent.click(screen.getByRole("button", { name: /Theme/ }));
  expect(document.documentElement.dataset.theme).toBe("light");
  await userEvent.click(screen.getByRole("button", { name: /Theme/ }));
  expect(document.documentElement.dataset.theme).toBe("dark");
});
