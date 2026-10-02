import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { alertMock } = vi.hoisted(() => ({
  alertMock: {
    MIN_VOLUME: 0.1,
    getState: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    arm: vi.fn(),
    selfTest: vi.fn(),
    getVolume: vi.fn(),
    setVolume: vi.fn(),
  },
}));
vi.mock("../../utils/order-alert", () => alertMock);

import SoundStatusChip from "../SoundStatusChip";

const armedState = {
  armed: true, ringing: false, contextState: "running", ringingForMs: 0,
  bufferLoaded: true, sinkId: null, hasBeenActive: true,
};

beforeEach(() => {
  alertMock.getState.mockReturnValue(armedState);
  alertMock.getVolume.mockReturnValue(0.4);
  alertMock.setVolume.mockClear();
});

afterEach(cleanup);

describe("SoundStatusChip volume slider", () => {
  it("sits next to Test sound and shows the saved volume", () => {
    render(<SoundStatusChip />);
    expect(screen.getByText("Test sound")).toBeTruthy();
    const slider = screen.getByLabelText("Order alert volume") as HTMLInputElement;
    expect(slider.value).toBe("40");
    expect(slider.min).toBe("10");
    expect(slider.max).toBe("100");
    expect(screen.getByText("40%")).toBeTruthy();
  });

  it("moving it updates the label and saves the volume", () => {
    render(<SoundStatusChip />);
    fireEvent.change(screen.getByLabelText("Order alert volume"), { target: { value: "25" } });
    expect(alertMock.setVolume).toHaveBeenCalledWith(0.25);
    expect(screen.getByText("25%")).toBeTruthy();
  });

  it("is not shown in the Sound off state (only the fix button is)", () => {
    alertMock.getState.mockReturnValue({ ...armedState, armed: false });
    render(<SoundStatusChip />);
    expect(screen.queryByLabelText("Order alert volume")).toBeNull();
    expect(screen.getByText(/Sound off/)).toBeTruthy();
  });
});
