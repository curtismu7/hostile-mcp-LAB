import React, { useEffect, useState } from "react";
import Gallery from "./pages/Gallery.jsx";
import Run from "./pages/Run.jsx";
import RugPull from "./pages/RugPull.jsx";
import Limits from "./pages/Limits.jsx";
import Diagram from "./pages/Diagram.jsx";
import { getHealth } from "./lib/api.js";

// Hash-routed pages (no router dependency). The banner is always on screen: this server is hostile on purpose.
export const PAGES = [
  ["gallery", "Gallery", Gallery],
  ["run", "Run the victim", Run],
  ["rugpull", "Rug-pull", RugPull],
  ["limits", "Honest limits", Limits],
  ["diagram", "Diagram", Diagram],
];
const read = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } };
const pageFromHash = () => {
  const id = window.location.hash.replace(/^#\/?/, "").split("?")[0];
  return PAGES.some(([p]) => p === id) ? id : "gallery";
};

export default function App() {
  const [page, setPage] = useState(pageFromHash);
  const [theme, setTheme] = useState(() => (["light", "dark"].includes(read("hostile.theme", "")) ? read("hostile.theme", "") : "system"));
  const [mockOnly, setMockOnly] = useState(false);
  const [present, setPresent] = useState(() => read("hostile.present", "0") === "1");

  useEffect(() => { getHealth().then((h) => setMockOnly(h?.mode === "mock-only")).catch(() => {}); }, []);
  useEffect(() => {
    const on = () => setPage(pageFromHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    if (present) document.documentElement.dataset.present = "1"; else delete document.documentElement.dataset.present;
  }, [present]);

  const cycle = () => { const next = { system: "light", light: "dark", dark: "system" }[theme]; setTheme(next); write("hostile.theme", next); };
  const togglePresent = () => { write("hostile.present", present ? "0" : "1"); setPresent(!present); };
  const Page = PAGES.find(([id]) => id === page)[2];

  return (
    <>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      <div className="banner" role="note" data-testid="banner">
        <strong>This MCP server is deliberately hostile.</strong> Every payload is shown as inert text. The action tools are stubs, nothing is sent anywhere, and every off-box address is a reserved <code>.invalid</code> or example name.
      </div>
      {mockOnly && <div className="banner mock-only" role="note" data-testid="mock-banner">Hosted mock: sample data only, nothing leaves this server</div>}
      <header className="top">
        <h1>Hostile MCP</h1>
        <nav aria-label="Pages">
          {PAGES.map(([id, label]) => <a key={id} href={`#/${id}`} aria-current={id === page ? "page" : undefined}>{label}</a>)}
        </nav>
        <div className="tools-right">
          <button type="button" className="btn" aria-pressed={present} onClick={togglePresent}>Present</button>
          <button type="button" className="btn" onClick={cycle} title="Theme: system, light, dark">Theme: {theme}</button>
        </div>
      </header>
      <main className="page" id="main" tabIndex={-1}>
        <Page present={present} theme={theme} />
        <p className="muted small" data-admin-only>The server serves payloads and never scores or blocks. Pinning notices change; it does not judge content.</p>
      </main>
    </>
  );
}
