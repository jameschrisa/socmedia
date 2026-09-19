import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { applyCardFocus, useCardFocus } from "@/hooks/useCardFocus";

function Harness() {
  useCardFocus("main");
  return (
    <div>
      <main>
        <div className="card" data-testid="a"><button data-testid="a-btn">A</button></div>
        <div className="card" data-testid="b">B</div>
        <p data-testid="outside">outside</p>
      </main>
      <div role="dialog"><div className="card" data-testid="modal-card">M</div></div>
    </div>
  );
}

describe("card focus highlight", () => {
  it("highlights the clicked card, moves the highlight, and clears it when clicking outside", () => {
    const { getByTestId } = render(<Harness />);
    fireEvent.pointerDown(getByTestId("a-btn"));
    expect(getByTestId("a")).toHaveAttribute("data-focused", "true");
    fireEvent.pointerDown(getByTestId("b"));
    expect(getByTestId("b")).toHaveAttribute("data-focused", "true");
    expect(getByTestId("a")).not.toHaveAttribute("data-focused");
    fireEvent.pointerDown(getByTestId("outside"));
    expect(getByTestId("b")).not.toHaveAttribute("data-focused");
  });

  it("ignores clicks inside dialogs", () => {
    const { getByTestId } = render(<Harness />);
    fireEvent.pointerDown(getByTestId("a"));
    fireEvent.pointerDown(getByTestId("modal-card"));
    expect(getByTestId("a")).toHaveAttribute("data-focused", "true");
    expect(getByTestId("modal-card")).not.toHaveAttribute("data-focused");
  });

  it("applyCardFocus only marks cards inside the root", () => {
    document.body.innerHTML = '<main><div class="card" id="in"></div></main><div class="card" id="out"></div>';
    const root = document.querySelector("main")!;
    expect(applyCardFocus(document.getElementById("out"), root)).toBeNull();
    expect(applyCardFocus(document.getElementById("in"), root)?.id).toBe("in");
    document.body.innerHTML = "";
  });
});
