// Tests for the PIM-subset ISO-8601 duration parser/formatter.

import { describe, it, expect } from "vitest";
import {
  parseIsoDuration,
  formatIsoDuration,
  compareDurations,
  clampDuration,
} from "../src/duration.js";

describe("parseIsoDuration", () => {
  it("parses days only", () => {
    expect(parseIsoDuration("P5D")).toEqual({ days: 5 });
  });

  it("parses hours only", () => {
    expect(parseIsoDuration("PT8H")).toEqual({ hours: 8 });
  });

  it("parses minutes only", () => {
    expect(parseIsoDuration("PT30M")).toEqual({ minutes: 30 });
  });

  it("parses days + hours", () => {
    expect(parseIsoDuration("P1DT2H")).toEqual({ days: 1, hours: 2 });
  });

  it("parses hours + minutes", () => {
    expect(parseIsoDuration("PT2H30M")).toEqual({ hours: 2, minutes: 30 });
  });

  it("parses zero values when explicitly stated", () => {
    expect(parseIsoDuration("PT0H")).toEqual({ hours: 0 });
  });

  it.each([
    "",
    "P",
    "PT",
    " PT8H",
    "PT8H ",
    "P0.5D",
    "PT0.5H",
    "P1W",
    "P1M",
    "P1Y",
    "PT1S",
    "PT1H30S",
    "-PT1H",
    "PT-1H",
    "P5",
    "5D",
    "pt8h",
  ])("rejects %s", (bad) => {
    expect(() => parseIsoDuration(bad)).toThrow(/invalid ISO-8601 duration/);
  });

  it("rejects non-string input", () => {
    expect(() => parseIsoDuration(123 as unknown as string)).toThrow(/invalid ISO-8601 duration/);
  });
});

describe("formatIsoDuration", () => {
  it("formats days only", () => {
    expect(formatIsoDuration({ days: 5 })).toBe("P5D");
  });

  it("formats hours only", () => {
    expect(formatIsoDuration({ hours: 8 })).toBe("PT8H");
  });

  it("formats minutes only", () => {
    expect(formatIsoDuration({ minutes: 30 })).toBe("PT30M");
  });

  it("formats days + hours + minutes", () => {
    expect(formatIsoDuration({ days: 1, hours: 2, minutes: 30 })).toBe("P1DT2H30M");
  });

  it("omits zero components", () => {
    expect(formatIsoDuration({ days: 1, hours: 0, minutes: 5 })).toBe("P1DT5M");
  });

  it("round-trips through parseIsoDuration", () => {
    for (const s of ["P5D", "PT8H", "PT30M", "P1DT2H", "PT2H30M", "P1DT2H30M"]) {
      expect(formatIsoDuration(parseIsoDuration(s))).toBe(s);
    }
  });

  it("rejects all-zero durations", () => {
    expect(() => formatIsoDuration({})).toThrow(/zero duration/);
    expect(() => formatIsoDuration({ days: 0, hours: 0, minutes: 0 })).toThrow(/zero duration/);
  });

  it("rejects negative components", () => {
    expect(() => formatIsoDuration({ hours: -1 })).toThrow(/negative duration component/);
  });

  it("rejects non-integer components", () => {
    expect(() => formatIsoDuration({ hours: 0.5 })).toThrow(/non-integer duration component/);
  });
});

describe("compareDurations", () => {
  it("returns 0 for equal durations across representations", () => {
    expect(compareDurations({ hours: 24 }, { days: 1 })).toBe(0);
    expect(compareDurations({ minutes: 60 }, { hours: 1 })).toBe(0);
    expect(compareDurations({ hours: 1, minutes: 30 }, { minutes: 90 })).toBe(0);
  });

  it("returns -1 when a < b", () => {
    expect(compareDurations({ hours: 1 }, { hours: 2 })).toBe(-1);
    expect(compareDurations({ minutes: 30 }, { hours: 1 })).toBe(-1);
  });

  it("returns 1 when a > b", () => {
    expect(compareDurations({ days: 2 }, { hours: 1 })).toBe(1);
  });
});

describe("clampDuration", () => {
  it("returns the requested duration unchanged when within range", () => {
    const { value, clamped } = clampDuration({ hours: 4 }, { hours: 8 });
    expect(value).toEqual({ hours: 4 });
    expect(clamped).toBe(false);
  });

  it("returns the requested duration unchanged when equal to max", () => {
    const { value, clamped } = clampDuration({ hours: 8 }, { hours: 8 });
    expect(value).toEqual({ hours: 8 });
    expect(clamped).toBe(false);
  });

  it("clamps to max when requested exceeds it", () => {
    const { value, clamped } = clampDuration({ hours: 12 }, { hours: 8 });
    expect(value).toEqual({ hours: 8 });
    expect(clamped).toBe(true);
  });

  it("compares across mixed representations", () => {
    const { value, clamped } = clampDuration({ days: 1 }, { hours: 8 });
    expect(value).toEqual({ hours: 8 });
    expect(clamped).toBe(true);
  });
});
