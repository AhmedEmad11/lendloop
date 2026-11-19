import { describe, expect, test } from "vitest";
import { daysBetween, parseIsoDate, rangesOverlap, todayUtc } from "./dates";

describe("dates", () => {
  test("todayUtc uses UTC, not local time", () => {
    expect(todayUtc(Date.parse("2026-11-19T23:59:59Z"))).toBe("2026-11-19");
    expect(todayUtc(Date.parse("2026-11-20T00:00:00Z"))).toBe("2026-11-20");
  });

  test("parseIsoDate rejects rollovers and bad formats", () => {
    expect(parseIsoDate("2026-02-28")).not.toBeNull();
    expect(parseIsoDate("2028-02-29")).not.toBeNull(); // leap year
    expect(parseIsoDate("2026-02-29")).toBeNull();
    expect(parseIsoDate("2026-13-01")).toBeNull();
    expect(parseIsoDate("2026-1-01")).toBeNull();
    expect(parseIsoDate("2026-01-01T00:00:00Z")).toBeNull();
  });

  test("daysBetween counts calendar days across month ends", () => {
    expect(daysBetween("2026-11-30", "2026-12-01")).toBe(1);
    expect(daysBetween("2026-11-20", "2026-11-20")).toBe(0);
  });

  test("rangesOverlap is inclusive on both ends", () => {
    expect(rangesOverlap("2026-11-20", "2026-11-22", "2026-11-22", "2026-11-25")).toBe(true);
    expect(rangesOverlap("2026-11-20", "2026-11-22", "2026-11-23", "2026-11-25")).toBe(false);
    expect(rangesOverlap("2026-11-20", "2026-11-30", "2026-11-22", "2026-11-23")).toBe(true);
  });
});
