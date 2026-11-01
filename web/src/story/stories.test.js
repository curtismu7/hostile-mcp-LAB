import { expect, test } from "vitest";
import { STORIES, VERTICALS, storyForMode } from "./stories.js";
import { fillAll, tokensIn } from "./fill.js";
import { validateStory, validateVertical } from "./storySchema.js";

test("all three stories and all three packs are valid", () => {
  expect(STORIES.map((s) => s.id)).toEqual(["S05", "S14", "S36"]);
  expect(VERTICALS.map((v) => v.id).sort()).toEqual(["airlines", "banking", "generic"]);
  for (const s of STORIES) expect(validateStory(s, { modes: ["gallery", "run", "rugpull", "limits", "diagram", "gateway"], stepRange: [1, 6] })).toEqual([]);
  for (const v of VERTICALS) expect(validateVertical(v)).toEqual([]);
});

test("every token in every story resolves in every vertical", () => {
  for (const s of STORIES) for (const v of VERTICALS) {
    const filled = JSON.stringify(fillAll(s, v));
    expect(filled, `${s.id} in ${v.id}`).not.toContain("missing:");
    for (const t of tokensIn(s)) expect(t.startsWith("vocab.") ? v.vocab[t.slice(6)] : v.cast[t]).toBeTruthy();
  }
});

test("the stories sit on their pages and the banking pack changes the wording", () => {
  expect(storyForMode("rugpull").id).toBe("S05");
  expect(storyForMode("diagram").id).toBe("S05");
  expect(storyForMode("run").id).toBe("S14");
  expect(storyForMode("gallery").id).toBe("S14");
  expect(storyForMode("gateway").id).toBe("S36");
  expect(storyForMode("limits")).toBeNull();
  const banking = VERTICALS.find((v) => v.id === "banking");
  expect(JSON.stringify(fillAll(STORIES[0], banking))).toContain("the bank");
});

test("a story with a missing token or bad shape is reported", () => {
  expect(validateStory({ id: "S05" }).length).toBeGreaterThan(3);
  expect(JSON.stringify(fillAll({ a: "{{nobody}}" }, VERTICALS[0]))).toContain("missing: nobody");
});
