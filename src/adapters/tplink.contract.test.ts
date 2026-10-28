import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyMeshParentNames,
  applyMeshSignalScale,
  meshSignalLevelColor,
  detectLinkRateUnit,
  isTrackerStateOnline,
  mapTrackerStateToRow,
  parseApName,
  preferredRouterDeviceIds,
  selectRouterTrackers,
} from "./tplink";
import type { EntityRegistryEntry, HassEntity } from "../core/types";

const loadFixture = <T>(name: string): T => {
  const filePath = resolve(process.cwd(), "fixtures", "tplink_router", name);
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
};

describe("tplink adapter contract fixtures", () => {
  it("selects trackers by config entry even when platform metadata is mixed", () => {
    const fixture = loadFixture<{
      entryId: string;
      states: Record<string, HassEntity>;
      entityRegistry: EntityRegistryEntry[];
    }>("entry_scoped_tracker_selection.json");

    const selected = selectRouterTrackers(
      fixture.states,
      fixture.entityRegistry,
      fixture.entryId,
      false,
    );
    expect(selected.map((item) => item.entity_id).sort()).toEqual([
      "device_tracker.client_a",
      "device_tracker.client_b",
    ]);
  });

  it("prefers non-tracker device ids for router-level metadata", () => {
    const fixture = loadFixture<{
      entryId: string;
      entityRegistry: EntityRegistryEntry[];
    }>("router_device_preference.json");

    const ids = preferredRouterDeviceIds(fixture.entityRegistry, fixture.entryId);
    expect(ids).toEqual(["device-router-main"]);
  });

  it("maps client row with link-rate unit detection from fixture payload", () => {
    const fixture = loadFixture<{
      state: HassEntity;
      speedUnit: "MBps" | "Mbps";
      expected: {
        connectionType: "iot";
        bandType: "2g";
        txRate: string;
        rxRate: string;
        onlineTime: string;
        signal: string;
      };
    }>("client_link_rate_kbps.json");

    const linkRateUnit = detectLinkRateUnit([fixture.state]);
    const row = mapTrackerStateToRow(fixture.state, fixture.speedUnit, linkRateUnit);

    expect(linkRateUnit).toBe("kbps");
    expect(row.connectionType).toBe(fixture.expected.connectionType);
    expect(row.bandType).toBe(fixture.expected.bandType);
    expect(row.txRate).toBe(fixture.expected.txRate);
    expect(row.rxRate).toBe(fixture.expected.rxRate);
    expect(row.onlineTime).toBe(fixture.expected.onlineTime);
    expect(row.signal).toBe(fixture.expected.signal);
  });

  it("parses redacted diagnostic export fixture without breaking row mapping", () => {
    const fixture = loadFixture<{
      selection: { entry_id: string };
      states: HassEntity[];
      entity_registry: EntityRegistryEntry[];
    }>("diagnostic_export_minimal.json");

    const stateMap = Object.fromEntries(
      fixture.states.map((state) => [state.entity_id, state] as const),
    );
    const selected = selectRouterTrackers(
      stateMap,
      fixture.entity_registry,
      fixture.selection.entry_id,
      false,
    );

    expect(selected.length).toBeGreaterThan(0);

    const linkRateUnit = detectLinkRateUnit(selected);
    expect(linkRateUnit).toBe("kbps");

    const target = selected.find((state) => state.entity_id === "device_tracker.client_iot_1");
    expect(target).toBeDefined();

    const row = mapTrackerStateToRow(target as HassEntity, "MBps", linkRateUnit);
    expect(row.ip).toBe("192.xxx.xxx.24");
    expect(row.mac).toBe("AA-**-**-**-**-24");
    expect(row.txRate).toBe("65.0 Mbps");
    expect(row.rxRate).toBe("52.0 Mbps");
  });

  it("maps connection_type fallback and infers band for deco-like trackers", () => {
    const fixture = loadFixture<{
      state: HassEntity;
      speedUnit: "MBps" | "Mbps";
      expected: {
        connection: string;
        connectionType: "wifi";
        band: string;
        bandType: "2g";
      };
    }>("connection_type_band_mapping.json");

    const linkRateUnit = detectLinkRateUnit([fixture.state]);
    const row = mapTrackerStateToRow(fixture.state, fixture.speedUnit, linkRateUnit);

    expect(row.connection).toBe(fixture.expected.connection);
    expect(row.connectionType).toBe(fixture.expected.connectionType);
    expect(row.band).toBe(fixture.expected.band);
    expect(row.bandType).toBe(fixture.expected.bandType);
  });

  it("treats unknown rows with 0.0.0.0 ip as offline and non-wifi", () => {
    const state: HassEntity = {
      entity_id: "device_tracker.unknown_client",
      state: "home",
      attributes: {
        source_type: "router",
        friendly_name: "Unknown Client",
        ip: "0.0.0.0",
        connection: "Unknown",
        band: "Unknown",
      },
    };

    const row = mapTrackerStateToRow(state, "MBps", "auto");
    expect(row.isOnline).toBe(false);
    expect(row.statusColor).toBe(
      "var(--tplink-router-card-offline-color, var(--error-color, #d32f2f))",
    );
    expect(row.connectionType).toBe("unknown");
    expect(row.bandType).toBe("unknown");
  });

  it("does not fall back to other entries when selected entry has no tracker match", () => {
    const states: Record<string, HassEntity> = {
      "device_tracker.client_a": {
        entity_id: "device_tracker.client_a",
        state: "home",
        attributes: { source_type: "router" },
      },
      "device_tracker.client_b": {
        entity_id: "device_tracker.client_b",
        state: "home",
        attributes: { source_type: "router" },
      },
    };
    const entityRegistry: EntityRegistryEntry[] = [
      {
        entity_id: "device_tracker.client_a",
        platform: "tplink_router",
        config_entry_id: "entry-a",
      },
      {
        entity_id: "device_tracker.client_b",
        platform: "tplink_deco",
        config_entry_id: "entry-b",
      },
    ];

    const selected = selectRouterTrackers(states, entityRegistry, "entry-c", false);
    expect(selected).toEqual([]);
  });

  it("returns empty while registry is still loading for a selected entry", () => {
    const states: Record<string, HassEntity> = {
      "device_tracker.client_a": {
        entity_id: "device_tracker.client_a",
        state: "home",
        attributes: { source_type: "router" },
      },
    };
    const selected = selectRouterTrackers(states, [], "entry-a", false);
    expect(selected).toEqual([]);
  });

  it("maps EasyMesh ap_name into the access point column and detects the main node marker", () => {
    const fixture = loadFixture<{
      speedUnit: "MBps" | "Mbps";
      states: Record<string, HassEntity>;
      expected: Record<
        string,
        { apName: string; apNameValue: string | null; apIsMainNode: boolean }
      >;
    }>("easymesh_ap_name.json");

    for (const [entityId, expected] of Object.entries(fixture.expected)) {
      const row = mapTrackerStateToRow(fixture.states[entityId], fixture.speedUnit, "auto");
      expect(row.apName, entityId).toBe(expected.apName);
      expect(row.apNameValue, entityId).toBe(expected.apNameValue);
      expect(row.apIsMainNode, entityId).toBe(expected.apIsMainNode);
    }
  });

  it("parses ap_name markers without leaking the asterisk into the label", () => {
    expect(parseApName("AX55 node")).toEqual({ name: "AX55 node", isMainNode: false });
    expect(parseApName("*Archer BE550")).toEqual({ name: "Archer BE550", isMainNode: true });
    expect(parseApName("* ")).toEqual({ name: null, isMainNode: true });
    expect(parseApName(undefined)).toEqual({ name: null, isMainNode: false });
    expect(parseApName("")).toEqual({ name: null, isMainNode: false });
  });

  it("treats a zone name state as online because HA scanner trackers can report the associated zone", () => {
    expect(isTrackerStateOnline("home")).toBe(true);
    expect(isTrackerStateOnline("Office")).toBe(true);
    expect(isTrackerStateOnline("on")).toBe(true);
    expect(isTrackerStateOnline("connected")).toBe(true);
    expect(isTrackerStateOnline("not_home")).toBe(false);
    expect(isTrackerStateOnline("unavailable")).toBe(false);
    expect(isTrackerStateOnline("unknown")).toBe(false);
    expect(isTrackerStateOnline("off")).toBe(false);
    expect(isTrackerStateOnline("")).toBe(false);
    expect(isTrackerStateOnline(null)).toBe(false);

    const zoned: HassEntity = {
      entity_id: "device_tracker.zoned_client",
      state: "Office",
      attributes: {
        source_type: "router",
        friendly_name: "Zoned Client",
        ip: "192.168.0.50",
        mac: "AA-BB-CC-DD-EE-50",
        connection: "host",
        band: "5G",
      },
    };
    const row = mapTrackerStateToRow(zoned, "MBps", "auto");
    expect(row.isOnline).toBe(true);
    expect(row.statusValue).toBe(1);

    const unavailable = { ...zoned, state: "unavailable" };
    expect(mapTrackerStateToRow(unavailable, "MBps", "auto").isOnline).toBe(false);
  });

  it("fills omada-only columns with placeholders for tplink rows", () => {
    const state: HassEntity = {
      entity_id: "device_tracker.plain_client",
      state: "home",
      attributes: { source_type: "router", friendly_name: "Plain", ip: "10.0.0.2" },
    };
    const row = mapTrackerStateToRow(state, "MBps", "auto");
    expect(row.channel).toBe("—");
    expect(row.channelValue).toBeNull();
    expect(row.wifiMode).toBe("—");
    expect(row.wifiModeValue).toBeNull();
    expect(row.lastSeen).toBe("—");
    expect(row.lastSeenValue).toBeNull();
  });
});

describe("tplink_router EasyMesh node trackers", () => {
  const fixture = loadFixture<{
    entryId: string;
    states: Record<string, HassEntity>;
    entityRegistry: EntityRegistryEntry[];
  }>("easymesh_node_trackers.json");
  const trackers = selectRouterTrackers(fixture.states, fixture.entityRegistry, fixture.entryId, false);
  const rows = applyMeshParentNames(
    trackers.map((state) => mapTrackerStateToRow(state, "MBps", detectLinkRateUnit(trackers))),
  );
  const byEntity = new Map(rows.map((row) => [row.entity_id, row] as const));

  it("recognises node trackers by is_main_router and leaves client rows alone", () => {
    expect(byEntity.get("device_tracker.virtual_archer_be550")?.meshRole).toBe("main");
    expect(byEntity.get("device_tracker.virtual_re330_hall")?.meshRole).toBe("satellite");
    expect(byEntity.get("device_tracker.vm_phone_hall")?.meshRole).toBeNull();
    expect(byEntity.get("device_tracker.vm_phone_hall")?.meshSignalLevel).toBeNull();
  });

  it("resolves parent_mac to the parent node name and badges the main router", () => {
    const hall = byEntity.get("device_tracker.virtual_re330_hall");
    expect(hall?.apName).toBe("Virtual Archer BE550");
    expect(hall?.apIsMainNode).toBe(true);
    const garage = byEntity.get("device_tracker.virtual_re330_garage");
    expect(garage?.apName).toBe("Virtual RE330 Hall");
    expect(garage?.apIsMainNode).toBe(false);
    const main = byEntity.get("device_tracker.virtual_archer_be550");
    expect(main?.apName).toBe("—");
    expect(main?.apIsMainNode).toBe(false);
  });

  it("keeps the raw parent MAC when the parent node is not tracked", () => {
    const shed = byEntity.get("device_tracker.virtual_re330_shed");
    expect(shed?.apName).toBe("02-56-4D-01-00-99");
    expect(shed?.apIsMainNode).toBe(false);
  });

  it("keeps the client ap_name mapping unchanged", () => {
    expect(byEntity.get("device_tracker.vm_phone_hall")?.apName).toBe("Virtual RE330 Hall");
    expect(byEntity.get("device_tracker.vm_phone_hall")?.apIsMainNode).toBe(false);
    expect(byEntity.get("device_tracker.vm_laptop_main")?.apName).toBe("Virtual Archer BE550");
    expect(byEntity.get("device_tracker.vm_laptop_main")?.apIsMainNode).toBe(true);
    expect(byEntity.get("device_tracker.vm_phone_hall")?.signalValue).toBe(-55);
  });

  it("maps the backhaul as wired or wifi and the bar level without inventing dBm", () => {
    const hall = byEntity.get("device_tracker.virtual_re330_hall");
    expect(hall?.connectionType).toBe("wifi");
    expect(hall?.meshSignalLevel).toBe(3);
    expect(hall?.signalValue).toBeNull();
    expect(hall?.signal).toBe("—");
    const garage = byEntity.get("device_tracker.virtual_re330_garage");
    expect(garage?.connectionType).toBe("wired");
    expect(garage?.connection.toLowerCase()).toBe("wired");
    expect(garage?.meshSignalLevel).toBeNull();
    expect(byEntity.get("device_tracker.virtual_archer_be550")?.connectionType).toBe("unknown");
  });

  it("fills role, model and client count for node rows", () => {
    const main = byEntity.get("device_tracker.virtual_archer_be550");
    expect(main?.deviceType).toBe("Main Router");
    expect(main?.deviceModel).toBe("Archer BE550");
    expect(main?.clientCount).toBe("34");
    expect(main?.clientCountValue).toBe(34);
    const hall = byEntity.get("device_tracker.virtual_re330_hall");
    expect(hall?.deviceType).toBe("Satellite");
    expect(hall?.deviceModel).toBe("RE330");
    expect(byEntity.get("device_tracker.vm_phone_hall")?.deviceType).toBe("—");
    expect(byEntity.get("device_tracker.vm_phone_hall")?.clientCount).toBe("—");
  });

  it("reports a dropped node as offline", () => {
    const attic = byEntity.get("device_tracker.virtual_re330_attic");
    expect(attic?.isOnline).toBe(false);
    expect(attic?.apName).toBe("Virtual Archer BE550");
  });

  it("is a no-op for rows without mesh parents", () => {
    const clientOnly = rows.filter((row) => row.meshRole === null);
    expect(applyMeshParentNames(clientOnly)).toBe(clientOnly);
  });

  describe("signal level scale", () => {
    const scaled = (input: typeof rows) =>
      new Map(applyMeshSignalScale(input).map((row) => [row.entity_id, row] as const));
    const withMainModel = (model: string) =>
      rows.map((row) => (row.meshRole === "main" ? { ...row, deviceModel: model } : row));

    it("uses three bars behind a BE main router", () => {
      const byId = scaled(rows);
      expect(byId.get("device_tracker.virtual_re330_hall")?.meshSignalMax).toBe(3);
      expect(byId.get("device_tracker.virtual_re330_attic")?.meshSignalMax).toBe(3);
      expect(byId.get("device_tracker.virtual_re330_garage")?.meshSignalMax).toBeNull();
      expect(byId.get("device_tracker.vm_phone_hall")?.meshSignalMax).toBeNull();
    });

    it("uses five bars behind other routers and when a node reports more than three", () => {
      expect(scaled(withMainModel("Archer AX55")).get("device_tracker.virtual_re330_hall")?.meshSignalMax).toBe(5);
      const aboveThree = rows.map((row) =>
        row.entity_id === "device_tracker.virtual_re330_shed" ? { ...row, meshSignalLevel: 4 } : row,
      );
      expect(scaled(aboveThree).get("device_tracker.virtual_re330_hall")?.meshSignalMax).toBe(5);
    });

    it("uses five bars when the main router is not tracked", () => {
      const noMain = rows.filter((row) => row.meshRole !== "main");
      expect(scaled(noMain).get("device_tracker.virtual_re330_hall")?.meshSignalMax).toBe(5);
    });

    it("colours the level from bad to excellent across the scale", () => {
      expect([1, 2, 3, 4, 5].map((level) => meshSignalLevelColor(level, 5))).toEqual([
        "var(--signal-bad)",
        "var(--signal-poor)",
        "var(--signal-fair)",
        "var(--signal-good)",
        "var(--signal-excellent)",
      ]);
      expect([1, 2, 3].map((level) => meshSignalLevelColor(level, 3))).toEqual([
        "var(--signal-bad)",
        "var(--signal-fair)",
        "var(--signal-excellent)",
      ]);
    });

    it("is a no-op without signal levels", () => {
      const clientOnly = rows.filter((row) => row.meshRole === null);
      expect(applyMeshSignalScale(clientOnly)).toBe(clientOnly);
    });
  });
});
