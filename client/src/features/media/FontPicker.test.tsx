import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FontPicker } from "./FontPicker";
import { FONTS, SANS_FONTS, SERIF_FONTS, fontStack } from "@/lib/fontManifest";

describe("font library", () => {
  it("ships two dozen self-hosted fonts split between sans and serif", () => {
    expect(FONTS).toHaveLength(25);
    expect(SANS_FONTS).toHaveLength(13);
    expect(SERIF_FONTS).toHaveLength(12);
    expect(fontStack("Lora")).toBe('"Lora", serif');
    expect(fontStack("Inter")).toBe('"Inter", sans-serif');
  });

  it("renders grouped options and emits the chosen family", () => {
    const onChange = vi.fn();
    render(<FontPicker value="Inter" onChange={onChange} />);
    const select = screen.getByTestId("font-picker") as HTMLSelectElement;
    expect(select.querySelectorAll("optgroup")).toHaveLength(2);
    expect(select.querySelectorAll("option")).toHaveLength(25);
    fireEvent.change(select, { target: { value: "Playfair Display" } });
    expect(onChange).toHaveBeenCalledWith("Playfair Display");
  });
});
