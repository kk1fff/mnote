import { afterEach, describe, expect, it } from "vitest";
import { clearDraft, loadDraft, saveDraft } from "./drafts";

afterEach(() => {
  clearDraft("ideas/one");
});

describe("drafts", () => {
  it("stores a fork and clears when synced", () => {
    saveDraft("ideas/one", "base", "local");
    expect(loadDraft("ideas/one")).toEqual({ base: "base", local: "local" });
    saveDraft("ideas/one", "same", "same");
    expect(loadDraft("ideas/one")).toBeNull();
    saveDraft("ideas/one", "base", "local");
    clearDraft("ideas/one");
    expect(loadDraft("ideas/one")).toBeNull();
  });
});
