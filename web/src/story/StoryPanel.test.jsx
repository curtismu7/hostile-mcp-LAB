import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test } from "vitest";
import StoryPanel from "./StoryPanel.jsx";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

test("the Allowed/Blocked switch changes the wording of a step that has a blocked version", async () => {
  render(<StoryPanel mode="rugpull" />);
  await userEvent.click(screen.getByRole("button", { name: /3\s*Compare/ }));
  expect(screen.getByText(/An ungoverned client takes list #2 as it comes/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Blocked" }));
  expect(screen.getByText(/withholds that tool and shows the field diff/)).toBeInTheDocument();
  expect(screen.getByText(/Proof:/).parentElement).toHaveTextContent(/reported as changed, withheld/);
});

test("the vertical re-skins the story and is remembered", async () => {
  render(<StoryPanel mode="rugpull" />);
  expect(screen.getByText(/Story S05 · Generic/)).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Vertical"), "banking");
  expect(screen.getByText(/Story S05 · Super Banking/)).toBeInTheDocument();
  expect(screen.getByText(/that the bank approved last week/)).toBeInTheDocument();
  cleanup();
  render(<StoryPanel mode="rugpull" />);
  expect(screen.getByText(/Story S05 · Super Banking/)).toBeInTheDocument();
});

test("the panel hides, stays open in presenter mode, and a page with no story renders nothing", async () => {
  const { rerender, container } = render(<StoryPanel mode="run" />);
  expect(screen.getByText("The description told the agent to move money")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Hide talk track" }));
  expect(screen.queryByText("Goal")).toBeNull();
  rerender(<StoryPanel mode="run" present />);
  expect(screen.getByText("Goal")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /talk track/ })).toBeDisabled();
  rerender(<StoryPanel mode="limits" />);
  expect(container).toBeEmptyDOMElement();
});
