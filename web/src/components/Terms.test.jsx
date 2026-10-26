import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Terms, { DEFINITIONS, Term, TermsNote } from "./Terms.jsx";

describe("glossary", () => {
  it("defines the two clients and the hash in plain words", () => {
    render(<Terms />);
    expect(screen.getByText("Words used in this demo")).toBeInTheDocument();
    expect(screen.getByText(DEFINITIONS["pinned client"])).toBeInTheDocument();
    expect(screen.getByText(DEFINITIONS["ungoverned client"])).toBeInTheDocument();
    expect(DEFINITIONS.hash).toMatch(/SHA-256/);
  });

  it("gives a term its definition as hover text", () => {
    render(<Term word="pinned client">pinned client</Term>);
    expect(screen.getByText("pinned client")).toHaveAttribute("title", DEFINITIONS["pinned client"]);
  });
});

describe("terms note", () => {
  it("shows only the words a page asks for, with their definitions", () => {
    render(<TermsNote words={["pin", "pinned client"]} />);
    const note = screen.getByLabelText("Words used on this page");
    expect(note).toHaveTextContent(DEFINITIONS.pin);
    expect(note).toHaveTextContent(DEFINITIONS["pinned client"]);
    expect(note).not.toHaveTextContent("Victim");
  });
});
