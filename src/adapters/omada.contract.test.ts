import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildOmadaRows,
  buildOmadaClientMetrics,
  mapOmadaStateToRow,
  selectOmadaTrackers,
} from "./omada";
import type {
  DeviceRegistryEntry,
  EntityRegistryEntry,
  HassEntity,
} from "../core/types";

const loadFixture = <T>(name: string): T => {
  const filePath = resolve(process.cwd(), "fixtures", "omada", name);
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
};

describe("omada adapter contract fixtures", () => {
  it("selects omada trackers and maps activity sensors into row values", () => {
    const fixture = loadFixture<{
      entryId: string;
      states: Record<string, HassEntity>;
      entityRegistry: EntityRegistryEntry[];
    }>("client_activity_mapping.json");

    const trackers = selectOmadaTrackers(
      fixture.states,
      fixture.entityRegistry,
      fixture.entryId,
      false,
    );

    expect(trackers.map((item) => item.entity_id)).toEqual(["device_tracker.john_phone"]);

    const metricsByDevice = buildOmadaClientMetrics(
      fixture.states,
      fixture.entityRegistry,
      fixture.entryId,
    );
    const row = mapOmadaStateToRow(
      fixture.states["device_tracker.john_phone"],
      "MBps",
      metricsByDevice.get("client-device-1"),
    );

    expect(row.connectionType).toBe("wifi");
    expect(row.bandType).toBe("5g");
    expect(row.upSpeed).toBe("0.50 MB/s");
    expect(row.downSpeed).toBe("1.50 MB/s");
    expect(row.txRate).toBe("—");
    expect(row.rxRate).toBe("—");
    expect(row.trafficUsage).toBe("190 MiB");
    expect(row.signal).toBe("-52 dBm");
  });

  it("keeps tplink_omada trackers selected even with minimal tracker attributes", () => {
    const fixture = loadFixture<{
      entryId: string;
      states: Record<string, HassEntity>;
      entityRegistry: EntityRegistryEntry[];
    }>("tplink_omada_entry_minimal.json");

    const trackers = selectOmadaTrackers(
      fixture.states,
      fixture.entityRegistry,
      fixture.entryId,
      false,
    );

    expect(trackers.map((item) => item.entity_id)).toEqual([
      "device_tracker.m11pc_wifi",
    ]);

    const row = mapOmadaStateToRow(
      fixture.states["device_tracker.m11pc_wifi"],
      "MBps",
    );

    expect(row.name).toBe("VM Client WiFi");
    expect(row.connectionType).toBe("wifi");
    expect(row.ip).toBe("10.50.0.21");
    expect(row.mac).toBe("02-50-00-00-00-21");
  });

  it("infers wired connection from switch fields and maps device metadata columns", () => {
    const state: HassEntity = {
      entity_id: "device_tracker.vm_linux_wired",
      state: "home",
      attributes: {
        friendly_name: "vm-linux-wired",
        source_type: "router",
        ip: "10.50.0.24",
        mac: "02:11:22:33:44:04",
        host_name: "vm-linux-wired",
        switch_port: 3,
        switch_name: "SG2210MP",
        type: "switch",
        model: "SG2210MP",
        firmware: "1.0.0",
        status: "connected",
      },
    };

    const row = mapOmadaStateToRow(state, "MBps");
    expect(row.connection).toBe("Wired");
    expect(row.connectionType).toBe("wired");
    expect(row.deviceType).toBe("Switch");
    expect(row.deviceModel).toBe("SG2210MP");
    expect(row.deviceFirmware).toBe("1.0.0");
    expect(row.deviceStatus).toBe("connected");
  });

  it("maps TX/RX only from explicit link-rate attributes when available", () => {
    const state: HassEntity = {
      entity_id: "device_tracker.vm_wifi_client",
      state: "home",
      attributes: {
        friendly_name: "vm-wifi-client",
        source_type: "router",
        ip: "10.50.0.41",
        mac: "02:11:22:33:44:41",
        host_name: "vm-wifi-client",
        wireless: true,
        radio: "5ghz",
        tx_rate: 866,
        rx_rate: 1201,
      },
    };

    const row = mapOmadaStateToRow(state, "MBps");
    expect(row.txRate).toBe("866 Mbps");
    expect(row.rxRate).toBe("1201 Mbps");
    expect(row.txRateValue).toBe(866);
    expect(row.rxRateValue).toBe(1201);
  });

  it("does not fall back to other entries when selected entry has no tracker match", () => {
    const states: Record<string, HassEntity> = {
      "device_tracker.client_a": {
        entity_id: "device_tracker.client_a",
        state: "home",
        attributes: {
          source_type: "router",
          wireless: true,
        },
      },
      "device_tracker.client_b": {
        entity_id: "device_tracker.client_b",
        state: "home",
        attributes: {
          source_type: "router",
          wireless: true,
        },
      },
    };
    const entityRegistry: EntityRegistryEntry[] = [
      {
        entity_id: "device_tracker.client_a",
        platform: "tplink_omada",
        config_entry_id: "entry-a",
      },
      {
        entity_id: "device_tracker.client_b",
        platform: "omada",
        config_entry_id: "entry-b",
      },
    ];

    const selected = selectOmadaTrackers(states, entityRegistry, "entry-c", false);
    expect(selected).toEqual([]);
  });

  it("returns empty while registry is still loading for a selected entry", () => {
    const states: Record<string, HassEntity> = {
      "device_tracker.client_a": {
        entity_id: "device_tracker.client_a",
        state: "home",
        attributes: {
          source_type: "router",
          wireless: true,
        },
      },
    };
    const selected = selectOmadaTrackers(states, [], "entry-a", false);
    expect(selected).toEqual([]);
  });

  it("builds omada rows per device and includes wired trackers without wireless attributes", () => {
    const fixture = loadFixture<{
      entryId: string;
      states: Record<string, HassEntity>;
      entityRegistry: EntityRegistryEntry[];
      deviceRegistry: DeviceRegistryEntry[];
    }>("device_based_rows.json");

    const rows = buildOmadaRows(
      fixture.states,
      fixture.entityRegistry,
      fixture.deviceRegistry,
      fixture.entryId,
      false,
      "MBps",
    );

    expect(rows.map((row) => row.name)).toEqual([
      "ER707-M2 Router",
      "Client WiFi 1",
      "Client Wired 1",
      "Omada Controller",
    ]);

    const wired = rows.find((row) => row.name === "Client Wired 1");
    expect(wired?.connection).toBe("Wired");
    expect(wired?.connectionType).toBe("wired");
    expect(wired?.upSpeed).toBe("—");
    expect(wired?.downSpeed).toBe("—");

    const wifi = rows.find((row) => row.name === "Client WiFi 1");
    expect(wifi?.connectionType).toBe("wifi");
    expect(wifi?.connection).toBe("WiFi");
    expect(wifi?.ip).toBe("10.50.0.31");
    expect(wifi?.upSpeed).toBe("0.50 MB/s");
    expect(wifi?.downSpeed).toBe("1.25 MB/s");
    expect(wifi?.signal).toBe("-51 dBm");
    expect(wifi?.snr).toBe("—");
    expect(wifi?.powerSave).toBe("—");
    expect(wifi?.deviceId).toBe("dev-client-wifi");
  });
});
