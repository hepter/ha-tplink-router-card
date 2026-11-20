import { describe, expect, it } from "vitest";
import type { DeviceRegistryEntry, EntityRegistryEntry } from "../core/types";
import {
  buildLinkedDeviceIndex,
  resolveDeviceIconTarget,
  routerHardwareDevices,
} from "./linked-device";

const ROUTER_ENTRY = "router-entry";
const ROUTER_DOMAINS = new Set(["tplink_router", "tplink_deco"]);
const DOMAINS = new Map([
  [ROUTER_ENTRY, "tplink_router"],
  ["deco-entry", "tplink_deco"],
  ["ac-entry", "gree"],
  ["fan-entry", "hass_dyson"],
  ["wol-entry", "wake_on_lan"],
]);

const entity = (entity_id: string, device_id: string): EntityRegistryEntry => ({
  entity_id,
  platform: "test",
  device_id,
});

const build = (devices: DeviceRegistryEntry[], entities: EntityRegistryEntry[] = []) =>
  buildLinkedDeviceIndex(devices, entities, DOMAINS, ROUTER_ENTRY, ROUTER_DOMAINS);

describe("buildLinkedDeviceIndex", () => {
  it("links a router client to the device of the integration sharing its MAC", () => {
    const index = build([
      {
        id: "router-side",
        name: "00-00-5E-00-53-01",
        config_entries: [ROUTER_ENTRY],
        config_entry_id: ROUTER_ENTRY,
        connections: [["mac", "00:00:5e:00:53:01"]],
      },
      {
        id: "ac",
        name: "AC",
        name_by_user: "Living room AC",
        config_entries: ["ac-entry"],
        config_entry_id: "ac-entry",
        connections: [["mac", "00:00:5E:00:53:01"]],
      },
    ]);
    expect(index.get("00005e005301")).toEqual({
      deviceId: "ac",
      name: "Living room AC",
      integration: "gree",
      others: 0,
    });
  });

  it("ignores devices that only belong to router integrations", () => {
    const index = build([
      {
        id: "router-side",
        config_entries: [ROUTER_ENTRY],
        connections: [["mac", "00:00:5e:00:53:02"]],
      },
      {
        id: "deco-side",
        config_entries: ["deco-entry"],
        connections: [["mac", "00:00:5e:00:53:02"]],
      },
    ]);
    expect(index.size).toBe(0);
  });

  it("keeps the shared device of Home Assistant before 2026.10", () => {
    const index = build([
      {
        id: "shared",
        name: "Fan",
        config_entries: [ROUTER_ENTRY, "fan-entry"],
        primary_config_entry: "fan-entry",
        connections: [["mac", "00-00-5E-00-53-03"]],
      },
    ]);
    expect(index.get("00005e005303")).toMatchObject({
      deviceId: "shared",
      integration: "hass_dyson",
    });
  });

  it("prefers the enabled device with the most entities and counts the others", () => {
    const index = build(
      [
        {
          id: "wol",
          name: "PC wake",
          config_entries: ["wol-entry"],
          connections: [["mac", "00:00:5e:00:53:04"]],
        },
        {
          id: "fan",
          name: "Fan",
          config_entries: ["fan-entry"],
          connections: [["mac", "00:00:5e:00:53:04"]],
        },
        {
          id: "disabled",
          name: "A disabled one",
          disabled_by: "user",
          config_entries: ["ac-entry"],
          connections: [["mac", "00:00:5e:00:53:04"]],
        },
      ],
      [
        entity("switch.pc", "wol"),
        entity("fan.fan", "fan"),
        entity("sensor.fan", "fan"),
        entity("climate.a", "disabled"),
        entity("sensor.a", "disabled"),
        entity("sensor.b", "disabled"),
      ],
    );
    expect(index.get("00005e005304")).toEqual({
      deviceId: "fan",
      name: "Fan",
      integration: "hass_dyson",
      others: 2,
    });
  });

  it("skips Bluetooth and malformed connections and unknown integrations stay empty", () => {
    const index = build([
      {
        id: "bt",
        config_entries: ["ac-entry"],
        connections: [
          ["bluetooth", "00:00:5e:00:53:05"],
          ["mac", "not-a-mac"],
        ],
      },
      {
        id: "unknown",
        name: "Mystery",
        config_entry_id: "missing-entry",
        connections: [["mac", "00:00:5e:00:53:06"]],
      },
    ]);
    expect(index.has("00005e005305")).toBe(false);
    expect(index.get("00005e005306")).toMatchObject({ deviceId: "unknown", integration: "" });
  });
});

describe("resolveDeviceIconTarget", () => {
  it("gives a client tracker without a device the icon of the linked device", () => {
    expect(resolveDeviceIconTarget({ linkedDeviceId: "ac", meshRole: null })).toEqual({
      deviceId: "ac",
      linked: true,
    });
  });

  it("prefers the linked device over the router-side device of a client", () => {
    expect(
      resolveDeviceIconTarget({ deviceId: "router-side", linkedDeviceId: "ac", meshRole: null }),
    ).toEqual({ deviceId: "ac", linked: true });
  });

  it("keeps the router integration device of a mesh node", () => {
    expect(
      resolveDeviceIconTarget({ deviceId: "node", linkedDeviceId: "upnp", meshRole: "satellite" }),
    ).toEqual({ deviceId: "node", linked: false });
    expect(resolveDeviceIconTarget({ linkedDeviceId: "upnp", meshRole: "main" })).toEqual({
      deviceId: "upnp",
      linked: true,
    });
  });

  it("keeps the own device of router hardware", () => {
    expect(
      resolveDeviceIconTarget({ deviceId: "ap", linkedDeviceId: "upnp", meshRole: null }, true),
    ).toEqual({ deviceId: "ap", linked: false });
  });

  it("finds router hardware by identifiers, not by the entities it carries", () => {
    const set = routerHardwareDevices(
      [
        // tplink_router 2.47+ client device: MAC only, even with a Blocked switch
        {
          id: "client",
          config_entry_id: ROUTER_ENTRY,
          connections: [["mac", "00:00:5e:00:53:01"]],
        },
        {
          id: "satellite",
          config_entry_id: ROUTER_ENTRY,
          identifiers: [["tplink_router", "00-00-5E-00-53-B0"]],
          connections: [["mac", "00:00:5e:00:53:b0"]],
        },
        { id: "other", identifiers: [["upnp", "uuid"]] },
      ],
      ROUTER_DOMAINS,
    );
    expect([...set]).toEqual(["satellite"]);
  });

  it("shows no icon without any device", () => {
    expect(resolveDeviceIconTarget({ meshRole: null })).toBeNull();
  });
});
