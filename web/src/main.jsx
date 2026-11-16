import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { setDefaultJsonView } from "./components/JsonPane.jsx";
import "./standalone-ui.css";
import "./top-menu/top-menu.css";
import "./components/JsonPane.css";
import "./components/VerifyMark.css";
import "./app.css";

// This lab teaches what the hostile JSON-RPC wire text looks like: panes open on JSON (a visitor's saved Form | JSON choice still wins).
setDefaultJsonView("raw");
createRoot(document.getElementById("root")).render(<App />);
