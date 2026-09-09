import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import DateSuggest from "./DateSuggest.vue";

const now = new Date(2026, 8, 13);

describe("DateSuggest", () => {
  it("starts on today and follows typed weekday and day queries", async () => {
    const wrapper = mount(DateSuggest, {
      props: { journalDates: new Set(["2026-09-13"]), now },
      attachTo: document.body,
    });
    const input = wrapper.get('[data-testid="date-suggest-input"]');
    expect(wrapper.get('[data-testid="date-suggest-candidate"]').text()).toBe("Sunday, Sep 13, 2026");
    expect(wrapper.get('[data-testid="cal-day-2026-09-13"]').classes()).toContain("active");
    expect(wrapper.get('[data-testid="cal-day-2026-09-13"]').classes()).toContain("journal");

    await input.setValue("mon");
    expect(wrapper.get('[data-testid="date-suggest-candidate"]').text()).toBe("Monday, Sep 14, 2026");
    expect(wrapper.get('[data-testid="cal-day-2026-09-14"]').classes()).toContain("active");

    await input.setValue("14");
    expect(wrapper.get('[data-testid="cal-day-2026-09-14"]').classes()).toContain("active");

    await input.setValue("xyz");
    expect(wrapper.get('[data-testid="date-suggest-candidate"]').text()).toBe("No matching date");

    await input.setValue("mon");
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("insert")?.[0]).toEqual(["2026-09-14"]);
    wrapper.unmount();
  });

  it("inserts a clicked day and cancels on escape", async () => {
    const wrapper = mount(DateSuggest, {
      props: { journalDates: new Set<string>(), now },
      attachTo: document.body,
    });
    await wrapper.get('[data-testid="cal-day-2026-09-20"]').trigger("click");
    expect(wrapper.emitted("insert")?.[0]).toEqual(["2026-09-20"]);
    await wrapper.get('[data-testid="date-suggest-input"]').trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("cancel")).toHaveLength(1);
    wrapper.unmount();
  });
});
