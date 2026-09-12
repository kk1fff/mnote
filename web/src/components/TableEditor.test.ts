import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import TableEditor from "./TableEditor.vue";

const source = "Name | Qty\n--- | ---:\nApples | 12\nBread | 2";
const wrappers: ReturnType<typeof mount>[] = [];
function open() {
  const wrapper = mount(TableEditor, { props: { source, conflict: false }, attachTo: document.body });
  wrappers.push(wrapper);
  return wrapper;
}
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()); });

describe("table editor session", () => {
  it("cancels draft edits without emitting Apply and applies untouched source exactly", async () => {
    const wrapper = open();
    await wrapper.get('[data-cell="1:0"]').trigger("click");
    await wrapper.get('[data-cell="1:0"]').trigger("dblclick");
    await wrapper.get('[data-cell-input]').setValue("changed");
    await wrapper.findAll("button").find(b => b.text() === "+ Row")!.trigger("click");
    await wrapper.findAll("button").find(b => b.text() === "Cancel")!.trigger("click");
    expect(wrapper.emitted("cancel")).toHaveLength(1);
    expect(wrapper.emitted("apply")).toBeUndefined();
    const unchanged = open();
    await unchanged.findAll("button").find(b => b.text() === "Apply")!.trigger("click");
    expect(unchanged.emitted("apply")?.[0]).toEqual([source]);
  });

  it("commits active input on Apply and undoes structural operations locally", async () => {
    const wrapper = open();
    await wrapper.get('[data-cell="1:0"]').trigger("click");
    await wrapper.get('[data-cell="1:0"]').trigger("keydown", { key: "Enter" });
    await wrapper.get('[data-cell-input]').setValue("Pears");
    await wrapper.findAll("button").find(b => b.text() === "+ Row")!.trigger("click");
    expect(wrapper.findAll('tbody tr')).toHaveLength(4);
    await wrapper.get('[aria-label="Undo table change"]').trigger("click");
    expect(wrapper.findAll('tbody tr')).toHaveLength(3);
    await wrapper.get('[aria-label="Undo table change"]').trigger("click");
    expect(wrapper.get('[data-cell="1:0"]').text()).toBe("Apples");
    await wrapper.get('[aria-label="Redo table change"]').trigger("click");
    expect(wrapper.get('[data-cell="1:0"]').text()).toBe("Pears");
    await wrapper.get('[data-cell="1:0"]').trigger("keydown", { key: "Enter" });
    await wrapper.get('[data-cell-input]').setValue("Final");
    await wrapper.findAll("button").find(b => b.text() === "Apply")!.trigger("click");
    expect(wrapper.emitted("apply")?.[0]?.[0]).toContain("| Final | 12 |");
  });

  it("supports keyboard ranges, clear, escape and IME without accidental submission", async () => {
    const wrapper = open();
    const first = wrapper.get('[data-cell="1:0"]');
    await first.trigger("click");
    await first.trigger("keydown", { key: "ArrowRight", shiftKey: true });
    expect(wrapper.findAll('td[aria-selected="true"]')).toHaveLength(2);
    await wrapper.get('[data-cell="1:1"]').trigger("keydown", { key: "Delete" });
    expect(wrapper.get('[data-cell="1:0"]').text()).toBe("");
    await wrapper.get('[aria-label="Undo table change"]').trigger("click");
    await first.trigger("click");
    await first.trigger("keydown", { key: "Enter", isComposing: true });
    expect(wrapper.find("textarea").exists()).toBe(false);
    await first.trigger("keydown", { key: "Enter" });
    await wrapper.get("textarea").setValue("discard");
    await wrapper.get("textarea").trigger("keydown", { key: "Escape" });
    expect(wrapper.get('[data-cell="1:0"]').text()).toBe("Apples");
    expect(wrapper.emitted("cancel")).toBeUndefined();
    await first.trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("cancel")).toHaveLength(1);
  });

  it("blocks Apply on conflict while preserving the draft", async () => {
    const wrapper = open();
    await wrapper.get('[data-cell="1:0"]').trigger("click");
    await wrapper.get('[data-cell="1:0"]').trigger("keydown", { key: "Enter" });
    await wrapper.get("textarea").setValue("My draft");
    await wrapper.setProps({ conflict: true });
    await wrapper.get("textarea").trigger("keydown", { key: "Enter", ctrlKey: true });
    await flushPromises();
    expect(wrapper.emitted("apply")).toBeUndefined();
    expect(wrapper.get('[data-cell="1:0"]').text()).toBe("My draft");
    expect(wrapper.get('[role="alert"]').text()).toContain("Your draft is still here");
  });
});
