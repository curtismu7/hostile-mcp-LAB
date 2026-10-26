import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Terms, { DEFINITIONS, Term } from "./Terms.jsx";

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
