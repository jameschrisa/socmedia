import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useAppStore } from "@/store/appStore";
import { resolveTheme, useThemeMode } from "@/hooks/useThemeMode";
import { Wordmark } from "@/components/ui/Wordmark";

function Probe() { const mode = useThemeMode(); return <span data-testid="mode">{mode}</span>; }

describe("theme", () => {
  beforeEach(() => { useAppStore.setState({ theme: "dark" }); delete document.documentElement.dataset.theme; });

  it("applies the stored preference to <html data-theme> and resolves system", () => {
    render(<Probe />);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByTestId("mode")).toHaveTextContent("dark");
    act(() => useAppStore.getState().setTheme("light"));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(resolveTheme("system")).toMatch(/dark|light/);
  });

  it("wordmark reads suprstar as plain bold text", () => {
    render(<Wordmark />);
    const mark = screen.getByTestId("wordmark");
    expect(mark).toHaveTextContent("suprstar");
    expect(mark.querySelectorAll("span")).toHaveLength(0);
    expect(mark).toHaveClass("wordmark");
    fireEvent.click(mark);
  });
});
