import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { detectLinkRateUnit, mapTrackerStateToRow } from "./tplink";
import type { HassEntity } from "../core/types";

const loadFixture = <T>(name: string): T => {
  const filePath = resolve(process.cwd(), "fixtures", "tplink_deco", name);
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
};

describe("tplink_deco contract fixtures", () => {
  it("maps deco client interface and kilobytes-per-second speeds", () => {
    const fixture = loadFixture<{
      state: HassEntity;
      speedUnit: "MBps" | "Mbps";
      expected: {
        connection: string;
        connectionType: "iot";
        band: string;
        bandType: "5g";
        upSpeed: string;
        downSpeed: string;
      };
    }>("client_tracker_kilobytes.json");

    const linkRateUnit = detectLinkRateUnit([fixture.state]);
    const row = mapTrackerStateToRow(fixture.state, fixture.speedUnit, linkRateUnit);

    expect(row.connection).toBe(fixture.expected.connection);
    expect(row.connectionType).toBe(fixture.expected.connectionType);
    expect(row.band).toBe(fixture.expected.band);
    expect(row.bandType).toBe(fixture.expected.bandType);
    expect(row.upSpeed).toBe(fixture.expected.upSpeed);
    expect(row.downSpeed).toBe(fixture.expected.downSpeed);
  });

  it("maps deco device attributes into extended metadata columns", () => {
    const fixture = loadFixture<{
      state: HassEntity;
      speedUnit: "MBps" | "Mbps";
      expected: {
        connection: string;
        connectionType: "wired";
        hostname: string;
        deviceType: string;
        deviceModel: string;
        deviceFirmware: string;
        deviceStatus: string;
      };
    }>("deco_device_attributes.json");

    const linkRateUnit = detectLinkRateUnit([fixture.state]);
    const row = mapTrackerStateToRow(fixture.state, fixture.speedUnit, linkRateUnit);

    expect(row.connection).toBe(fixture.expected.connection);
    expect(row.connectionType).toBe(fixture.expected.connectionType);
    expect(row.hostname).toBe(fixture.expected.hostname);
    expect(row.deviceType).toBe(fixture.expected.deviceType);
    expect(row.deviceModel).toBe(fixture.expected.deviceModel);
    expect(row.deviceFirmware).toBe(fixture.expected.deviceFirmware);
    expect(row.deviceStatus).toBe(fixture.expected.deviceStatus);
  });
});
