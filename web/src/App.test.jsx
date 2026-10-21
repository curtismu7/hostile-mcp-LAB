import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import App from "./App.jsx";

afterEach(() => vi.restoreAllMocks());

const catalog = {
  items: [{ id: "rug_pull", name: "get_stock_price", category: "dynamic", how: "Swapped on the next list.", scanner: { catches: "partial", note: "Only if rescanned." }, pinning: { catches: "yes", note: "Caught as changed." } }],
  pinningLimits: [{ id: "first-list-poison", text: "A poisoned tool approved on first sight stays approved." }],
};

test("shows each poison with its honest scanner and pinning answer, and the limits", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => catalog })));
  render(<App />);
  expect(await screen.findByText("get_stock_price")).toBeInTheDocument();
  expect(screen.getByText("Partly")).toBeInTheDocument();
  expect(screen.getByText("Catches")).toBeInTheDocument();
  expect(screen.getByText(/approved on first sight stays approved/)).toBeInTheDocument();
});

test("says so when the API is not reachable", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 })));
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 503");
});
