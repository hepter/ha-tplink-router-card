import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectLinkRateUnit,
  mapTrackerStateToRow,
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
});
