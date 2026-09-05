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
    expect(row.statusColor).toBe(
      "var(--tplink-router-card-online-color, var(--success-color, #3aa45b))",
    );
    expect(row.upSpeed).toBe("0.50 MB/s");
    expect(row.downSpeed).toBe("1.50 MB/s");
    expect(row.txRate).toBe("—");
    expect(row.rxRate).toBe("—");
    expect(row.trafficUsage).toBe("190 MiB");
    expect(row.signal).toBe("-52 dBm");
  });

  it("keeps tplink_omada trackers selected even with minimal core tracker attributes", () => {
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

    expect(trackers.map((item) => item.entity_id).sort()).toEqual([
      "device_tracker.m11pc_away",
      "device_tracker.m11pc_wifi",
    ]);

    const online = mapOmadaStateToRow(
      fixture.states["device_tracker.m11pc_wifi"],
      "MBps",
      undefined,
      { assumeWirelessClients: true },
    );

    expect(online.name).toBe("VM Client WiFi");
    expect(online.isOnline).toBe(true);
    expect(online.connectionType).toBe("wifi");
    expect(online.connection).toBe("WiFi");
    expect(online.ip).toBe("10.50.0.21");
    expect(online.mac).toBe("02:50:00:00:00:21");
    expect(online.hostname).toBe("vm-client-01");
    expect(online.apName).toBe("—");

    const offline = mapOmadaStateToRow(
      fixture.states["device_tracker.m11pc_away"],
      "MBps",
      undefined,
      { assumeWirelessClients: true },
    );
    expect(offline.isOnline).toBe(false);
    expect(offline.ip).toBe("—");
    expect(offline.hostname).toBe("—");
    expect(offline.connectionType).toBe("wifi");
  });

  it("falls back to wired for attribute-less trackers unless wireless clients are assumed", () => {
    const fixture = loadFixture<{
      states: Record<string, HassEntity>;
    }>("tplink_omada_entry_minimal.json");
    const row = mapOmadaStateToRow(fixture.states["device_tracker.m11pc_wifi"], "MBps");
    expect(row.connectionType).toBe("wired");
  });

  it("builds tplink_omada rows as wireless clients when the option is passed through", () => {
    const fixture = loadFixture<{
      entryId: string;
      states: Record<string, HassEntity>;
      entityRegistry: EntityRegistryEntry[];
    }>("tplink_omada_entry_minimal.json");

    const rows = buildOmadaRows(
      fixture.states,
      fixture.entityRegistry,
      [],
      fixture.entryId,
      false,
      "MBps",
      { assumeWirelessClients: true },
    );
    expect(rows.map((row) => row.connectionType)).toEqual(["wifi", "wifi"]);
  });

  it("maps ha-omada wireless client attributes into access point, channel and wifi mode columns", () => {
    const fixture = loadFixture<{
      speedUnit: "MBps" | "Mbps";
      states: Record<string, HassEntity>;
      expected: Record<string, Record<string, unknown>>;
    }>("client_wifi_attributes.json");

    const laptop = mapOmadaStateToRow(fixture.states["device_tracker.john_laptop"], fixture.speedUnit);
    const expectedLaptop = fixture.expected["device_tracker.john_laptop"];
    expect(laptop.connectionType).toBe(expectedLaptop.connectionType);
    expect(laptop.bandType).toBe(expectedLaptop.bandType);
    expect(laptop.apName).toBe(expectedLaptop.apName);
    expect(laptop.apIsMainNode).toBe(false);
    expect(laptop.channel).toBe(expectedLaptop.channel);
    expect(laptop.channelValue).toBe(expectedLaptop.channelValue);
    expect(laptop.wifiMode).toBe(expectedLaptop.wifiMode);
    expect(laptop.wifiModeValue).toBe(expectedLaptop.wifiModeValue);
    expect(laptop.lastSeen).toBe("—");

    const watch = mapOmadaStateToRow(fixture.states["device_tracker.john_watch"], fixture.speedUnit);
    const expectedWatch = fixture.expected["device_tracker.john_watch"];
    expect(watch.isOnline).toBe(expectedWatch.isOnline);
    expect(watch.lastSeenValue).toBe(expectedWatch.lastSeenValue);
    expect(watch.lastSeen).not.toBe("—");

    const ap = mapOmadaStateToRow(fixture.states["device_tracker.eap_hall"], fixture.speedUnit);
    const expectedAp = fixture.expected["device_tracker.eap_hall"];
    expect(ap.deviceType).toBe(expectedAp.deviceType);
    expect(ap.deviceStatus).toBe(expectedAp.deviceStatus);
    expect(ap.band).toBe(expectedAp.band);
    expect(ap.bandType).toBe("unknown");
  });

  it("maps wifi_mode generations and last_seen in seconds or ISO form", () => {
    const base: HassEntity = {
      entity_id: "device_tracker.mode_client",
      state: "home",
      attributes: { source_type: "router", friendly_name: "Mode", wireless: true },
    };
    const modes: Array<[string, string, number | null]> = [
      ["11b", "WiFi 1", 1],
      ["11a", "WiFi 2", 2],
      ["11g", "WiFi 3", 3],
      ["11ng", "WiFi 4", 4],
      ["11na", "WiFi 4", 4],
      ["11ac", "WiFi 5", 5],
      ["11axa", "WiFi 6", 6],
      ["11axg", "WiFi 6", 6],
      ["11bea", "WiFi 7", 7],
      ["11beg", "WiFi 7", 7],
      ["custom", "custom", null],
    ];
    for (const [raw, label, generation] of modes) {
      const row = mapOmadaStateToRow(
        { ...base, attributes: { ...base.attributes, wifi_mode: raw } },
        "MBps",
      );
      expect(row.wifiMode, raw).toBe(label);
      expect(row.wifiModeValue, raw).toBe(generation);
    }

    const seconds = mapOmadaStateToRow(
      { ...base, state: "not_home", attributes: { ...base.attributes, last_seen: 1756800000 } },
      "MBps",
    );
    expect(seconds.lastSeenValue).toBe(1756800000000);

    const iso = mapOmadaStateToRow(
      {
        ...base,
        state: "not_home",
        attributes: { ...base.attributes, last_seen: "2026-09-02T08:00:00.000Z" },
      },
      "MBps",
    );
    expect(iso.lastSeenValue).toBe(Date.parse("2026-09-02T08:00:00.000Z"));
  });

  it("maps omada device status codes and categories to readable labels", () => {
    const device = (attributes: Record<string, unknown>, state = "home"): HassEntity => ({
      entity_id: "device_tracker.omada_device",
      state,
      attributes: { source_type: "router", friendly_name: "Device", type: "switch", ...attributes },
    });
    expect(mapOmadaStateToRow(device({ status_category: 1 }), "MBps").deviceStatus).toBe("Connected");
    expect(mapOmadaStateToRow(device({ status_category: 3 }), "MBps").deviceStatus).toBe(
      "Heartbeat Missed",
    );
    expect(mapOmadaStateToRow(device({ status: 11 }), "MBps").deviceStatus).toBe("Configuring");
    expect(mapOmadaStateToRow(device({ status: 14 }), "MBps").deviceStatus).toBe("Connected");
    expect(mapOmadaStateToRow(device({ status: "connected" }), "MBps").deviceStatus).toBe("connected");
    expect(mapOmadaStateToRow(device({}, "not_home"), "MBps").deviceStatus).toBe("Disconnected");
    expect(mapOmadaStateToRow(device({}), "MBps").deviceStatus).toBe("Connected");
  });

  it("keeps a leading asterisk in omada access point names", () => {
    const state: HassEntity = {
      entity_id: "device_tracker.starred",
      state: "home",
      attributes: { source_type: "router", friendly_name: "Starred", wireless: true, ap_name: "*Lab AP" },
    };
    const row = mapOmadaStateToRow(state, "MBps");
    expect(row.apName).toBe("*Lab AP");
    expect(row.apIsMainNode).toBe(false);
  });

  it("treats zone-name tracker states as online for omada rows", () => {
    const state: HassEntity = {
      entity_id: "device_tracker.zoned",
      state: "Office",
      attributes: { source_type: "router", friendly_name: "Zoned", wireless: true },
    };
    expect(mapOmadaStateToRow(state, "MBps").isOnline).toBe(true);
    expect(mapOmadaStateToRow({ ...state, state: "unavailable" }, "MBps").isOnline).toBe(false);
  });

  it("does not sniff tplink_router trackers as omada just because they carry ap_name", () => {
    const states: Record<string, HassEntity> = {
      "device_tracker.mesh_client": {
        entity_id: "device_tracker.mesh_client",
        state: "home",
        attributes: {
          source_type: "router",
          friendly_name: "Mesh Client",
          connection: "host",
          band: "5G",
          packets_sent: 1,
          packets_received: 1,
          ap_name: "AX55 node",
        },
      },
      "device_tracker.omada_client": {
        entity_id: "device_tracker.omada_client",
        state: "home",
        attributes: {
          source_type: "router",
          friendly_name: "Omada Client",
          wireless: true,
          ssid: "Home",
          ap_name: "EAP670",
        },
      },
    };
    const selected = selectOmadaTrackers(states, [], "entry-omada", true);
    expect(selected.map((item) => item.entity_id)).toEqual(["device_tracker.omada_client"]);
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
