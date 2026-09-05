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
  it("maps deco client interface, kilobytes-per-second speeds, ui_device_name and parent deco", () => {
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
        hostname: string;
        apName: string;
        signal: string;
        onlineTime: string;
        trafficUsage: string;
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
    expect(row.hostname).toBe(fixture.expected.hostname);
    expect(row.apName).toBe(fixture.expected.apName);
    expect(row.apIsMainNode).toBe(false);
    expect(row.signal).toBe(fixture.expected.signal);
    expect(row.onlineTime).toBe(fixture.expected.onlineTime);
    expect(row.trafficUsage).toBe(fixture.expected.trafficUsage);
  });

  it("does not use the parent deco name as the client hostname when ui_device_name is missing", () => {
    const state: HassEntity = {
      entity_id: "device_tracker.unnamed_client",
      state: "home",
      attributes: {
        friendly_name: "Living Room Unnamed",
        source_type: "router",
        device_type: "client",
        ip: "192.168.1.181",
        mac: "AA-BB-CC-DD-EE-01",
        interface: "main",
        connection_type: "band2_4",
        deco_device: "Living Room",
        deco_mac: "02-68-50-AA-10-02",
      },
    };

    const row = mapTrackerStateToRow(state, "MBps", "auto");
    expect(row.hostname).toBe("—");
    expect(row.apName).toBe("Living Room");
  });

  it("maps deco master attributes into extended metadata columns", () => {
    const fixture = loadFixture<{
      state: HassEntity;
      speedUnit: "MBps" | "Mbps";
      expected: {
        connection: string;
        connectionType: "wired";
        hostname: string;
        apName: string;
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
    expect(row.apName).toBe(fixture.expected.apName);
    expect(row.deviceType).toBe(fixture.expected.deviceType);
    expect(row.deviceModel).toBe(fixture.expected.deviceModel);
    expect(row.deviceFirmware).toBe(fixture.expected.deviceFirmware);
    expect(row.deviceStatus).toBe(fixture.expected.deviceStatus);
  });

  it("maps a satellite deco node with list connection_type, parent deco and unknown internet state", () => {
    const fixture = loadFixture<{
      state: HassEntity;
      speedUnit: "MBps" | "Mbps";
      expected: {
        connection: string;
        connectionType: "wifi";
        band: string;
        bandType: "5g";
        apName: string;
        deviceType: string;
        deviceStatus: string;
      };
    }>("deco_satellite_node.json");

    const row = mapTrackerStateToRow(fixture.state, fixture.speedUnit, "auto");

    expect(row.connection).toBe(fixture.expected.connection);
    expect(row.connectionType).toBe(fixture.expected.connectionType);
    expect(row.band).toBe(fixture.expected.band);
    expect(row.bandType).toBe(fixture.expected.bandType);
    expect(row.apName).toBe(fixture.expected.apName);
    expect(row.deviceType).toBe(fixture.expected.deviceType);
    expect(row.deviceStatus).toBe(fixture.expected.deviceStatus);
    expect(row.isOnline).toBe(true);
  });

  it("never interprets the tplink_router main-node marker in Deco names", () => {
    const state: HassEntity = {
      entity_id: "device_tracker.starred_client",
      state: "home",
      attributes: {
        friendly_name: "Starred",
        source_type: "router",
        device_type: "client",
        deco_device: "*Lab Deco",
        connection_type: "band5",
      },
    };
    const row = mapTrackerStateToRow(state, "MBps", "auto");
    expect(row.apName).toBe("*Lab Deco");
    expect(row.apIsMainNode).toBe(false);
  });

  it("keeps plain Deco type when the master flag is absent", () => {
    const state: HassEntity = {
      entity_id: "device_tracker.deco_legacy",
      state: "home",
      attributes: {
        friendly_name: "Legacy Deco",
        source_type: "router",
        device_type: "deco",
        device_model: "Deco M5",
        internet_online: false,
        connection_type: "wired",
        ip: "10.68.0.9",
        mac: "02-68-50-AA-10-09",
      },
    };
    const row = mapTrackerStateToRow(state, "MBps", "auto");
    expect(row.deviceType).toBe("Deco");
    expect(row.deviceStatus).toBe("Offline");
  });
});
