import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TimeScroller, formatMinutes, minutesOfDay, withMinutesOfDay } from "@/components/ui/TimeScroller";

describe("TimeScroller", () => {
  it("renders hour, minute and period columns with the current selection", () => {
    render(<TimeScroller value={14 * 60 + 35} onChange={() => {}} minuteStep={5} />);
    expect(screen.getByRole("listbox", { name: "hour" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "2", selected: true })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "35", selected: true })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "PM", selected: true })).toBeInTheDocument();
  });

  it("emits minutes since midnight when an option is clicked", () => {
    const onChange = vi.fn();
    render(<TimeScroller value={9 * 60} onChange={onChange} minuteStep={15} />);
    fireEvent.click(screen.getByRole("option", { name: "45" }));
    expect(onChange).toHaveBeenCalledWith(9 * 60 + 45);
    fireEvent.click(screen.getByRole("option", { name: "PM" }));
    expect(onChange).toHaveBeenCalledWith(21 * 60);
    fireEvent.click(screen.getByRole("option", { name: "12" }));
    expect(onChange).toHaveBeenCalledWith(0); // 12 AM
  });

  it("supports keyboard arrows", () => {
    const onChange = vi.fn();
    render(<TimeScroller value={10 * 60} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("listbox", { name: "hour" }), { key: "ArrowDown" });
    expect(onChange).toHaveBeenCalledWith(11 * 60);
  });

  it("snaps to the nearest minute step", () => {
    render(<TimeScroller value={10 * 60 + 7} onChange={() => {}} minuteStep={5} />);
    expect(screen.getByRole("option", { name: "05", selected: true })).toBeInTheDocument();
  });

  it("helpers convert between dates and minutes", () => {
    const d = new Date(2026, 8, 17, 16, 20);
    expect(minutesOfDay(d)).toBe(16 * 60 + 20);
    expect(formatMinutes(0)).toBe("12:00 AM");
    expect(formatMinutes(12 * 60 + 5)).toBe("12:05 PM");
    expect(formatMinutes(23 * 60 + 59)).toBe("11:59 PM");
    const moved = withMinutesOfDay(d, 8 * 60 + 30);
    expect(moved.getHours()).toBe(8);
    expect(moved.getMinutes()).toBe(30);
    expect(moved.getDate()).toBe(17);
  });
});
