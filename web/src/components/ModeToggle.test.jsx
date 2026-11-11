import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "../App.jsx";
import ModeToggle from "./ModeToggle.jsx";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Mock/Real toggle (rule 19)", () => {
  it("local, mock only: Mock is pressed and Real is disabled with the reason", () => {
    render(<ModeToggle info={{ mode: "local", hosted: false, source: "mock", realAvailable: false }} onSelect={() => {}} />);
    expect(screen.getByTestId("mode-mock")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("mode-real")).toBeDisabled();
    expect(screen.getByTestId("mode-real")).toHaveAttribute("title", expect.stringMatching(/no live version/));
  });

  it("hosted: Real is disabled saying the hosted build is Mock only", () => {
    render(<ModeToggle info={{ mode: "mock-only", hosted: true, source: "mock", realAvailable: false }} onSelect={() => {}} />);
    expect(screen.getByTestId("mode-real")).toBeDisabled();
    expect(screen.getByTestId("mode-real")).toHaveAttribute("title", "The hosted build is Mock only.");
  });

  it("when Real is available the buttons switch both ways and the pressed one does nothing", () => {
    const picked = [];
    const { rerender } = render(<ModeToggle info={{ hosted: false, source: "mock", realAvailable: true }} onSelect={(s) => picked.push(s)} />);
    fireEvent.click(screen.getByTestId("mode-mock"));
    expect(picked).toEqual([]);
    fireEvent.click(screen.getByTestId("mode-real"));
    expect(picked).toEqual(["real"]);
    rerender(<ModeToggle info={{ hosted: false, source: "real", realAvailable: true }} onSelect={(s) => picked.push(s)} />);
    fireEvent.click(screen.getByTestId("mode-mock"));
    expect(picked).toEqual(["real", "mock"]);
  });

  it("before the server answers both buttons are disabled", () => {
    render(<ModeToggle info={null} onSelect={() => {}} />);
    expect(screen.getByTestId("mode-mock")).toBeDisabled();
    expect(screen.getByTestId("mode-real")).toBeDisabled();
  });

  it("the page loads /api/info into the header toggle and asks for the switch through /api/mode", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
      calls.push({ url, method: init.method || "GET", body: init.body });
      const ok = (b) => ({ ok: true, status: 200, json: async () => b });
      if (url === "/api/info") return ok({ mode: "local", hosted: false, source: "real", realAvailable: true });
      if (url === "/api/mode") return ok({ mode: "local", hosted: false, source: JSON.parse(init.body).source, realAvailable: true });
      if (url === "/api/health") return ok({ schema: "demo-health/1", state: "ready" });
      return { ok: false, status: 404, json: async () => ({}) };
    });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("mode-select")).toHaveValue("real"));
    fireEvent.change(screen.getByTestId("mode-select"), { target: { value: "mock" } });
    await waitFor(() => expect(screen.getByTestId("mode-select")).toHaveValue("mock"));
    expect(JSON.parse(calls.find((c) => c.url === "/api/mode").body)).toEqual({ source: "mock" });
  });
});
