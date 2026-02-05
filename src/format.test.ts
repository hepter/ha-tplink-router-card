import { describe, expect, it } from "vitest";
import {
  formatBits,
  formatBytes,
  formatDuration,
  formatLinkSpeed,
  formatMbps,
  formatNumber,
  formatSpeed,
  normalizeLinkMbps,
  normalizeMbps,
  safeString,
} from "./format";

describe("format helpers", () => {
  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0.00 B");
    expect(formatBytes(1024)).toBe("1.00 KiB");
    expect(formatBytes(1536)).toBe("1.50 KiB");
    expect(formatBytes(1024 * 1024)).toBe("1.00 MiB");
    expect(formatBytes(null)).toBe("—");
  });

  it("formats duration", () => {
    expect(formatDuration(65)).toBe("00:01:05");
    expect(formatDuration(90061)).toBe("1d 01:01:01");
    expect(formatDuration(60 * 60 * 24 * 45)).toBe("1mo 15d 00:00:00");
    expect(formatDuration(null)).toBe("—");
  });

  it("formats rates", () => {
    expect(formatMbps(16390)).toBe("16.4 Mbps");
    expect(formatMbps(null)).toBe("—");
  });

  it("normalizes Mbps", () => {
    expect(normalizeMbps(16390)).toBeCloseTo(16.39, 2);
    expect(normalizeMbps(1_000_000_000)).toBeCloseTo(1000, 1);
    expect(normalizeMbps(500)).toBe(500);
  });

  it("normalizes link Mbps", () => {
    expect(normalizeLinkMbps(1630)).toBe(1630);
    expect(normalizeLinkMbps(1441170)).toBeCloseTo(1441.17, 2);
    expect(normalizeLinkMbps(1_600_000_000)).toBeCloseTo(1600, 1);
  });

  it("formats speed output unit", () => {
    expect(formatSpeed(16390, "MBps")).toBe("2.05 MB/s");
    expect(formatSpeed(16390, "Mbps")).toBe("16.4 Mbps");
  });

  it("formats link speed", () => {
    expect(formatLinkSpeed(1630)).toBe("1630 Mbps");
  });

  it("formats bits", () => {
    expect(formatBits(1000)).toBe("1.00 Kb");
    expect(formatBits(null)).toBe("—");
  });

  it("formats numbers", () => {
    expect(formatNumber(12)).toBe("12");
    expect(formatNumber(Number.NaN)).toBe("—");
  });

  it("handles safe strings", () => {
    expect(safeString("")).toBe("—");
    expect(safeString("Router")).toBe("Router");
    expect(safeString(null)).toBe("—");
  });
});
