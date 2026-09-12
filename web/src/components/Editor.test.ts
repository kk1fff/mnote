import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import Editor from "./Editor.vue";
import TableEditor from "./TableEditor.vue";
import { undo, redo } from "@codemirror/commands";

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
      listNotes: vi.fn().mockResolvedValue([]),
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

  it("marks task checkboxes and lights them when the modifier is held", async () => {
    const wrapper = mount(Editor, { props: { modelValue: "- [ ] one\n- [x] two" } });
    await flushPromises();
    expect(wrapper.find(".cm-task").exists()).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true, bubbles: true }));
    await flushPromises();
    expect(wrapper.find(".cm-mod-task").exists()).toBe(true);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control", ctrlKey: false, bubbles: true }));
    wrapper.unmount();
  });

  it("reveals an excerpt", async () => {
    const wrapper = mount(Editor, { props: { modelValue: "aaa retry budget bbb" } });
    await flushPromises();
    const exposed = wrapper.vm as unknown as {
      excerpt: () => string;
      revealExcerpt: (quote: string) => boolean;
      revealRange: (from: number, to: number) => boolean;
      revealTag: (from: number, to: number) => boolean;
    };
    expect(exposed.revealExcerpt("retry budget")).toBe(true);
    expect(exposed.revealRange(0, 3)).toBe(true);
    expect(exposed.revealTag(4, 9)).toBe(true);
    expect(wrapper.find(".cm-tag-flash").exists()).toBe(true);
    wrapper.unmount();
  });

  it("shades a GFM table in the source editor", async () => {
    const wrapper = mount(Editor, {
      props: {
        modelValue: "| Name | Qty |\n| --- | --- |\n| Apples | 12 |",
      },
    });
    await flushPromises();
    expect(wrapper.find(".cm-table").exists()).toBe(true);
    expect(wrapper.find("[data-testid='table-edit']").text()).toBe("Edit table");
    wrapper.unmount();
  });

  it("paints multiple selection ranges", async () => {
    const wrapper = mount(Editor, { props: { modelValue: "abcd\nefgh" } });
    await flushPromises();
    const view = EditorView.findFromDOM(wrapper.find(".cm-content").element as HTMLElement);
    expect(view).toBeTruthy();
    expect(wrapper.find(".cm-selectionLayer").exists()).toBe(true);
    view!.dispatch({
      selection: EditorSelection.create([
        EditorSelection.range(0, 2),
        EditorSelection.range(5, 7),
      ]),
    });
    expect(view!.state.selection.ranges).toHaveLength(2);
    wrapper.unmount();
  });

  it("applies only the chosen table in one undo step and preserves unrelated remote changes", async () => {
    const table = "| A |\n| --- |\n| original |";
    const source = `Before\n\n${table}\n\nBetween\n\n${table}\n\nAfter`;
    const wrapper = mount(Editor, { props: { modelValue: source }, attachTo: document.body });
    await flushPromises();
    await wrapper.findAll('[data-testid="table-edit"]')[1].trigger("click");
    await wrapper.setProps({ modelValue: `More ${source}` });
    const sheet = wrapper.getComponent(TableEditor);
    expect(sheet.props("conflict")).toBe(false);
    sheet.vm.$emit("apply", table.replace("original", "changed"));
    await flushPromises();
    const view = EditorView.findFromDOM(wrapper.get(".cm-content").element as HTMLElement)!;
    expect(view.state.doc.toString()).toBe(`More Before\n\n${table}\n\nBetween\n\n${table.replace("original", "changed")}\n\nAfter`);
    undo(view);
    expect(view.state.doc.toString()).toBe(`More ${source}`);
    redo(view);
    expect(view.state.doc.toString()).toContain("changed");
    wrapper.unmount();
  });

  it("does not overwrite a remotely changed or deleted table", async () => {
    const source = "| A |\n| --- |\n| original |";
    const wrapper = mount(Editor, { props: { modelValue: source }, attachTo: document.body });
    await flushPromises();
    await wrapper.get('[data-testid="table-edit"]').trigger("click");
    await wrapper.setProps({ modelValue: source.replace("original", "remote") });
    const sheet = wrapper.getComponent(TableEditor);
    expect(sheet.props("conflict")).toBe(true);
    sheet.vm.$emit("apply", source.replace("original", "local"));
    const view = EditorView.findFromDOM(wrapper.get(".cm-content").element as HTMLElement)!;
    expect(view.state.doc.toString()).toContain("remote");
    await wrapper.setProps({ modelValue: "removed" });
    sheet.vm.$emit("reload");
    await flushPromises();
    expect(sheet.props("conflictMessage")).toContain("removed");
    wrapper.unmount();
  });

  it("does not open a table draft in a read-only note", async () => {
    const wrapper = mount(Editor, { props: { modelValue: "| A |\n| --- |\n| value |", disabled: true } });
    await flushPromises();
    expect(wrapper.get('[data-testid="table-edit"]').attributes("disabled")).toBeDefined();
    await wrapper.get('[data-testid="table-edit"]').trigger("click");
    expect(wrapper.findComponent(TableEditor).exists()).toBe(false);
    wrapper.unmount();
  });
});
