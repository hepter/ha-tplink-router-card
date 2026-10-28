import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildOmadaRows,
  buildOmadaClientMetrics,
  isLikelyOmadaTrackerByAttrs,
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

    const controller = rows.find((row) => row.name === "Omada Controller");
    expect(controller?.deviceType).toBe("Controller");
    expect(controller?.connection).toBe("Controller");
    expect(controller?.connectionType).toBe("unknown");
    expect(controller?.band).toBe("—");
    expect(controller?.isOnline).toBe(true);
  });
});

describe("omada_open_api adapter contract fixture", () => {
  type Fixture = {
    entryId: string;
    states: Record<string, HassEntity>;
    entityRegistry: EntityRegistryEntry[];
    deviceRegistry: DeviceRegistryEntry[];
  };
  const fixture = loadFixture<Fixture>("omada_open_api_entry.json");
  const rows = buildOmadaRows(
    fixture.states,
    fixture.entityRegistry,
    fixture.deviceRegistry,
    fixture.entryId,
    false,
    "MBps",
    { locale: "en" },
  );
  const byEntity = new Map(rows.map((row) => [row.entity_id, row] as const));

  it("builds one row per client and infrastructure tracker and skips the site pseudo device", () => {
    expect(rows.map((row) => row.entity_id).sort()).toEqual([
      "device_tracker.virtual_eap670_hall",
      "device_tracker.virtual_er7212pc_gateway",
      "device_tracker.vm_cam_007",
      "device_tracker.vm_desk_001",
      "device_tracker.vm_phone_001",
    ]);
    expect(rows.some((row) => row.name.includes("Site"))).toBe(false);
  });

  it("collapses the doubled has_entity_name friendly name back to the device name", () => {
    expect(byEntity.get("device_tracker.vm_phone_001")?.name).toBe("vm-phone-001");
    expect(byEntity.get("device_tracker.virtual_eap670_hall")?.name).toBe("Virtual EAP670 Hall");
  });

  it("maps a wireless client from tracker attributes and sibling sensors", () => {
    const phone = byEntity.get("device_tracker.vm_phone_001");
    expect(phone).toBeDefined();
    expect(phone?.isOnline).toBe(true);
    expect(phone?.connection).toBe("WiFi");
    expect(phone?.connectionType).toBe("wifi");
    expect(phone?.band).toBe("5G");
    expect(phone?.apName).toBe("Virtual EAP670 Hall");
    expect(phone?.apIsMainNode).toBe(false);
    expect(phone?.ip).toBe("192.168.60.21");
    expect(phone?.mac).toBe("02:56:4d:03:10:01");
    expect(phone?.hostname).toBe("vm-phone-001");
    expect(phone?.signal).toBe("-46 dBm");
    expect(phone?.snr).toBe("18 dB");
    expect(phone?.downSpeed).toBe("0.96 MB/s");
    expect(phone?.upSpeed).toBe("0.12 MB/s");
    expect(phone?.downloadedValue).toBeCloseTo(4483.219216 * 1024 * 1024, 0);
    expect(phone?.uploadedValue).toBeCloseTo(893.208677 * 1024 * 1024, 0);
    expect(phone?.onlineTimeValue ?? 0).toBeGreaterThan(0);
    expect(phone?.powerSave).toBe("Off");
    expect(phone?.channel).toBe("—");
    expect(phone?.wifiMode).toBe("—");
  });

  it("ignores the percentage signal sensor and the text sensors that share keywords", () => {
    const phone = byEntity.get("device_tracker.vm_phone_001");
    // "Signal strength" (80 %) is listed after RSSI, "Connected to" after Uptime.
    expect(phone?.signalValue).toBe(-46);
    expect(phone?.onlineTimeValue).not.toBeNull();
  });

  it("maps a wired client attached to a switch", () => {
    const desk = byEntity.get("device_tracker.vm_desk_001");
    expect(desk?.connection).toBe("Wired");
    expect(desk?.connectionType).toBe("wired");
    expect(desk?.apName).toBe("—");
    expect(desk?.band).toBe("—");
    expect(desk?.signal).toBe("—");
    expect(desk?.snr).toBe("—");
    expect(desk?.downSpeed).toBe("3.78 MB/s");
    expect(desk?.hostname).toBe("vm-desk-001");
  });

  it("keeps blocked offline clients in the table", () => {
    const cam = byEntity.get("device_tracker.vm_cam_007");
    expect(cam?.isOnline).toBe(false);
    expect(cam?.connection).toBe("Wired");
    expect(cam?.ip).toBe("—");
    expect(cam?.mac).toBe("02:56:4d:03:10:7f");
  });

  it("maps infrastructure trackers through device_type, model, firmware and detail_status", () => {
    const ap = byEntity.get("device_tracker.virtual_eap670_hall");
    expect(ap?.deviceType).toBe("Access Point");
    expect(ap?.connection).toBe("Access Point");
    expect(ap?.deviceModel).toBe("EAP670");
    expect(ap?.deviceFirmware).toBe("5.1.6 (virtual)");
    expect(ap?.deviceStatus).toBe("Connected");
    expect(ap?.isOnline).toBe(true);

    const gateway = byEntity.get("device_tracker.virtual_er7212pc_gateway");
    expect(gateway?.deviceType).toBe("Gateway");
    expect(gateway?.connection).toBe("Gateway");
    expect(gateway?.ip).toBe("192.168.1.1");
  });

  it("recognises omada_open_api trackers by attributes without treating deco wired trackers as omada", () => {
    expect(isLikelyOmadaTrackerByAttrs(fixture.states["device_tracker.vm_phone_001"])).toBe(true);
    expect(isLikelyOmadaTrackerByAttrs(fixture.states["device_tracker.vm_desk_001"])).toBe(true);
    expect(isLikelyOmadaTrackerByAttrs(fixture.states["device_tracker.virtual_eap670_hall"])).toBe(
      true,
    );
    expect(
      isLikelyOmadaTrackerByAttrs({
        entity_id: "device_tracker.deco_client",
        state: "home",
        attributes: {
          source_type: "router",
          connection_type: "wired",
          interface: "main",
          deco_device: "Living Room",
        },
      }),
    ).toBe(false);
  });

  it("maps the controller signal quality percentage into its own coloured column", () => {
    const phone = byEntity.get("device_tracker.vm_phone_001");
    expect(phone?.signalStrength).toBe("80%");
    expect(phone?.signalStrengthValue).toBe(80);
    expect(phone?.signalStrengthColor).toBe("var(--signal-excellent)");
    expect(phone?.signalValue).toBe(-46);
    const desk = byEntity.get("device_tracker.vm_desk_001");
    expect(desk?.signalStrength).toBe("—");
    expect(desk?.signalStrengthValue).toBeNull();
  });

  it("fills ssid, connected device and vendor for clients", () => {
    const phone = byEntity.get("device_tracker.vm_phone_001");
    expect(phone?.ssid).toBe("MainNet 5G");
    expect(phone?.connectedTo).toBe("Virtual EAP670 Hall");
    expect(phone?.vendor).toBe("Apple");
    const desk = byEntity.get("device_tracker.vm_desk_001");
    expect(desk?.ssid).toBe("—");
    expect(desk?.connectedTo).toBe("Virtual SG3428XMPP Core Switch");
    expect(desk?.vendor).toBe("Dell");
    // No tracker attribute names the gateway, only the "Connected to" sensor does.
    expect(byEntity.get("device_tracker.vm_cam_007")?.connectedTo).toBe("Virtual ER7212PC Gateway");
  });

  it("fills client count, cpu, memory, uplink and pending firmware for infrastructure rows", () => {
    const ap = byEntity.get("device_tracker.virtual_eap670_hall");
    expect(ap?.clientCount).toBe("37");
    expect(ap?.clientCountValue).toBe(37);
    expect(ap?.cpu).toBe("12%");
    expect(ap?.memory).toBe("41%");
    expect(ap?.uplink).toBe("Virtual SG3428XMPP Core Switch / 5");
    expect(ap?.firmwareLatest).toBe("5.2.0 (virtual)");
    expect(ap?.deviceFirmware).toBe("5.1.6 (virtual)");
    expect(ap?.vendor).toBe("TP-Link");
    // Per-band counters and radio utilisation must not leak into the totals.
    expect(ap?.clientCountValue).not.toBe(21);
    expect(ap?.cpuValue).toBe(12);
    const gateway = byEntity.get("device_tracker.virtual_er7212pc_gateway");
    expect(gateway?.clientCount).toBe("—");
    expect(gateway?.firmwareLatest).toBeNull();
    expect(byEntity.get("device_tracker.vm_phone_001")?.cpu).toBe("—");
  });

  it("falls back to attribute sniffing for omada_open_api trackers when the registry failed", () => {
    const trackers = selectOmadaTrackers(fixture.states, [], fixture.entryId, true);
    const ids = trackers.map((item) => item.entity_id);
    expect(ids).toContain("device_tracker.vm_phone_001");
    expect(ids).toContain("device_tracker.virtual_eap670_hall");
  });
});

describe("omada shapes introduced after 0.6.0", () => {
  const entryId = "entry-omada-next";
  const reg = (entity_id: string, device_id?: string, extra: Partial<EntityRegistryEntry> = {}) => ({
    entity_id,
    platform: "omada_open_api",
    config_entry_id: entryId,
    ...(device_id ? { device_id } : {}),
    ...extra,
  });
  const st = (entity_id: string, state: string, attributes: Record<string, unknown>): HassEntity => ({
    entity_id,
    state,
    attributes,
  });

  it("skips a client whose tracker is disabled instead of guessing its state from the switch", () => {
    const states = {
      "switch.vm_phone_network_access": st("switch.vm_phone_network_access", "on", {
        friendly_name: "vm-phone Network access",
      }),
      "sensor.vm_phone_rssi": st("sensor.vm_phone_rssi", "-50", {
        unit_of_measurement: "dBm",
        friendly_name: "vm-phone RSSI",
      }),
    };
    const rows = buildOmadaRows(
      states,
      [
        reg("device_tracker.vm_phone", "dev-phone", { disabled_by: "integration" }),
        reg("switch.vm_phone_network_access", "dev-phone"),
        reg("sensor.vm_phone_rssi", "dev-phone"),
      ],
      [{ id: "dev-phone", name: "vm-phone" }],
      entryId,
      false,
      "MBps",
    );
    expect(rows).toEqual([]);
  });

  it("keeps an access point row from its sensors when its tracker is disabled", () => {
    const states = {
      "sensor.eap670_hall_clients": st("sensor.eap670_hall_clients", "12", {
        friendly_name: "EAP670 Hall Clients",
      }),
      "button.eap670_hall_reboot": st("button.eap670_hall_reboot", "unknown", {
        friendly_name: "EAP670 Hall Reboot",
      }),
      "update.eap670_hall_firmware": st("update.eap670_hall_firmware", "off", {
        installed_version: "1.0.5",
        latest_version: "1.0.5",
        friendly_name: "EAP670 Hall Firmware",
      }),
    };
    const ap = { id: "dev-ap", name: "EAP670 Hall", model: "EAP670" };
    const entries = [
      reg("device_tracker.eap670_hall", "dev-ap", { disabled_by: "integration" }),
      reg("sensor.eap670_hall_clients", "dev-ap"),
      reg("button.eap670_hall_reboot", "dev-ap"),
      reg("update.eap670_hall_firmware", "dev-ap"),
    ];
    const rows = buildOmadaRows(states, entries, [ap], entryId, false, "MBps");
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("EAP670 Hall");
    expect(rows[0].connection).toBe("Access Point");

    const unknownModel = buildOmadaRows(
      states,
      entries,
      [{ ...ap, model: "Omada Mesh Node" }],
      entryId,
      false,
      "MBps",
    );
    expect(unknownModel).toHaveLength(1);
  });

  it("does not take a client whose category contains 'controller' for an Omada controller", () => {
    const states = {
      "device_tracker.vm_gamepad": st("device_tracker.vm_gamepad", "home", {
        source_type: "router",
        mac: "02:56:4D:03:00:77",
        ip: "192.168.50.77",
        connection_type: "wireless",
      }),
    };
    const rows = buildOmadaRows(
      states,
      [reg("device_tracker.vm_gamepad", "dev-gamepad")],
      [{ id: "dev-gamepad", name: "vm-gamepad", model: "Game Controller" }],
      entryId,
      false,
      "MBps",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].deviceType).not.toBe("Controller");
  });

  it("lists the core tplink_omada software controller (model fallback 'Controller') as a Controller row", () => {
    const rows = buildOmadaRows(
      {
        "sensor.controller_main_campus_device_status": st(
          "sensor.controller_main_campus_device_status",
          "connected",
          { device_class: "enum", friendly_name: "Controller - Main Campus Device status" },
        ),
      },
      [
        {
          entity_id: "sensor.controller_main_campus_device_status",
          platform: "tplink_omada",
          config_entry_id: entryId,
          device_id: "dev-soft",
        },
      ],
      [{ id: "dev-soft", name: "Controller - Main Campus", model: "Controller" }],
      entryId,
      false,
      "MBps",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].deviceType).toBe("Controller");
  });

  it("lists the core tplink_omada controller device as a Controller row", () => {
    const states = {
      "sensor.oc300_main_campus_device_status": st("sensor.oc300_main_campus_device_status", "connected", {
        device_class: "enum",
        friendly_name: "OC300 - Main Campus Device status",
      }),
      "update.oc300_main_campus_firmware": st("update.oc300_main_campus_firmware", "on", {
        installed_version: "5.15.8",
        latest_version: "5.15.20",
        friendly_name: "OC300 - Main Campus Firmware",
      }),
    };
    const rows = buildOmadaRows(
      states,
      [
        { entity_id: "sensor.oc300_main_campus_device_status", platform: "tplink_omada", config_entry_id: entryId, device_id: "dev-ctrl" },
        { entity_id: "update.oc300_main_campus_firmware", platform: "tplink_omada", config_entry_id: entryId, device_id: "dev-ctrl" },
      ],
      [{ id: "dev-ctrl", name: "OC300 - Main Campus", model: "OC300", sw_version: "5.15.8" }],
      entryId,
      false,
      "MBps",
      { assumeWirelessClients: true },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].deviceType).toBe("Controller");
    expect(rows[0].connection).toBe("Controller");
    expect(rows[0].isOnline).toBe(true);
    expect(rows[0].deviceFirmware).toBe("5.15.8");
    expect(rows[0].firmwareLatest).toBe("5.15.20");
  });

  it("reads the omada_open_api 1.12 auto-discovery signal attributes and the parent device", () => {
    const tracker = st("device_tracker.vm_auto_001", "home", {
      source_type: "router",
      mac: "02:56:4d:03:10:30",
      ssid: "MainNet 5G",
      band: "5G",
      connection_type: "wireless",
      rssi_dbm: -61,
      snr_db: 30,
      signal_strength_percent: 72,
      friendly_name: "vm-auto-001",
    });
    const registry = [reg("device_tracker.vm_auto_001", "dev-auto")];
    const devices = [
      { id: "dev-auto", name: "vm-auto-001", via_device_id: "dev-ap" },
      { id: "dev-ap", name: "Virtual EAP670 Hall", model: "EAP670" },
    ];
    const withVia = buildOmadaRows(
      { "device_tracker.vm_auto_001": tracker },
      registry,
      devices,
      entryId,
      false,
      "MBps",
      { connectedToFromViaDevice: true },
    );
    expect(withVia).toHaveLength(1);
    expect(withVia[0].signalValue).toBe(-61);
    expect(withVia[0].snrValue).toBe(30);
    expect(withVia[0].signalStrengthValue).toBe(72);
    expect(withVia[0].connectedTo).toBe("Virtual EAP670 Hall");
    expect(withVia[0].connectionType).toBe("wifi");

    const withoutVia = buildOmadaRows(
      { "device_tracker.vm_auto_001": tracker },
      registry,
      devices,
      entryId,
      false,
      "MBps",
    );
    expect(withoutVia[0].connectedTo).toBe("—");
  });

  it("never names the site pseudo device as the parent", () => {
    const rows = buildOmadaRows(
      {
        "device_tracker.vm_auto_002": st("device_tracker.vm_auto_002", "home", {
          source_type: "router",
          mac: "02:56:4d:03:10:31",
          connection_type: "wired",
          friendly_name: "vm-auto-002",
        }),
      },
      [reg("device_tracker.vm_auto_002", "dev-auto-2")],
      [
        { id: "dev-auto-2", name: "vm-auto-002", via_device_id: "dev-site" },
        { id: "dev-site", name: "Main Campus - Site", model: "Omada Site" },
      ],
      entryId,
      false,
      "MBps",
      { connectedToFromViaDevice: true },
    );
    expect(rows[0].connectedTo).toBe("—");
  });
});

describe("ha-omada controller device row", () => {
  const entryId = "entry-omada-ctrl";
  const reg = (entity_id: string) => ({
    entity_id,
    platform: "omada",
    config_entry_id: entryId,
    device_id: "dev-ctrl",
  });
  const build = (optimizationRunning: string) =>
    buildOmadaRows(
      {
        "binary_sensor.ctrl_wlan_optimization_running": {
          entity_id: "binary_sensor.ctrl_wlan_optimization_running",
          state: optimizationRunning,
          attributes: { friendly_name: "Ctrl WLAN Optimization Running" },
        },
        "button.ctrl_start_wlan_optimization": {
          entity_id: "button.ctrl_start_wlan_optimization",
          state: "unknown",
          attributes: { friendly_name: "Ctrl Start WLAN Optimization" },
        },
        "button.ctrl_reconnect_all_clients": {
          entity_id: "button.ctrl_reconnect_all_clients",
          state: "unknown",
          attributes: { friendly_name: "Ctrl Reconnect All Clients" },
        },
        "sensor.ctrl_clients": {
          entity_id: "sensor.ctrl_clients",
          state: "113",
          attributes: { unit_of_measurement: "clients", friendly_name: "Ctrl Clients" },
        },
      },
      [
        reg("binary_sensor.ctrl_wlan_optimization_running"),
        reg("button.ctrl_start_wlan_optimization"),
        reg("button.ctrl_reconnect_all_clients"),
        reg("sensor.ctrl_clients"),
      ],
      [{ id: "dev-ctrl", name: "Virtual Omada Controller", model: "Omada Controller" }],
      entryId,
      false,
      "MBps",
    );

  it("is a Controller row that stays online whatever the optimization sensor says", () => {
    for (const running of ["on", "off"]) {
      const [row] = build(running);
      expect(row.deviceType, running).toBe("Controller");
      expect(row.connection, running).toBe("Controller");
      expect(row.connectionType, running).toBe("unknown");
      expect(row.isOnline, running).toBe(true);
      expect(row.deviceStatus, running).toBe("Connected");
    }
  });
});
