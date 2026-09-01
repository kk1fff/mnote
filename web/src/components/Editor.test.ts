import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import Editor from "./Editor.vue";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return {
    ...actual,
    api: {
      uploadAsset: vi.fn().mockResolvedValue({
        id: "1.png",
        url: "/api/assets/1.png",
        markdown: "![](/api/assets/1.png)",
      }),
      titleSearch: vi.fn().mockResolvedValue([]),
      recentNotes: vi.fn().mockResolvedValue([]),
      suggestTags: vi.fn().mockResolvedValue([{ name: "work", count: 1 }]),
    },
  };
});

describe("Editor", () => {
  it("emits edits and accepts image paste", async () => {
    const wrapper = mount(Editor, { props: { modelValue: "hello" } });
    await flushPromises();
    const cm = wrapper.find(".cm-content");
    expect(cm.exists()).toBe(true);
    expect(wrapper.props("modelValue")).toBe("hello");
    wrapper.unmount();
  });

  it("reveals an excerpt", async () => {
    const wrapper = mount(Editor, { props: { modelValue: "aaa retry budget bbb" } });
    await flushPromises();
    const exposed = wrapper.vm as unknown as {
      excerpt: () => string;
      revealExcerpt: (quote: string) => boolean;
      revealRange: (from: number, to: number) => boolean;
    };
    expect(exposed.revealExcerpt("retry budget")).toBe(true);
    expect(exposed.revealRange(0, 3)).toBe(true);
    wrapper.unmount();
  });
});
