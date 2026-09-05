import { describe, expect, it } from "vitest";
import { buildServiceRowActions } from "./service-row-actions";

const onlineClient = {
  entity_id: "device_tracker.john_laptop",
  mac: "02:50:00:00:00:61",
  macNormalized: "025000000061",
  isOnline: true,
  deviceId: undefined,
};

describe("core tplink_omada service row actions", () => {
  it("builds a hold-to-confirm reconnect action with mac and config entry payload", () => {
    const actions = buildServiceRowActions("tplink_omada", "entry-1", [onlineClient], "Reconnect");
    const list = actions.get("device_tracker.john_laptop");
    expect(list).toHaveLength(1);
    expect(list?.[0]).toMatchObject({
      domain: "service",
      role: "reconnect",
      requiresHold: true,
      available: true,
      label: "Reconnect",
      service: {
        domain: "tplink_omada",
        service: "reconnect_client",
        data: { mac: "02:50:00:00:00:61", config_entry_id: "entry-1" },
      },
    });
  });

  it("marks the action unavailable for offline clients", () => {
    const actions = buildServiceRowActions(
      "tplink_omada",
      "entry-1",
      [{ ...onlineClient, isOnline: false }],
      "Reconnect",
    );
    expect(actions.get("device_tracker.john_laptop")?.[0].available).toBe(false);
  });

  it("skips rows without a usable mac and non-tracker rows", () => {
    const actions = buildServiceRowActions(
      "tplink_omada",
      "entry-1",
      [
        { ...onlineClient, mac: "—", macNormalized: "" },
        { ...onlineClient, entity_id: "sensor.eap_cpu_usage" },
      ],
      "Reconnect",
    );
    expect(actions.size).toBe(0);
  });

  it("produces nothing for other integrations or without an entry id", () => {
    expect(buildServiceRowActions("omada", "entry-1", [onlineClient], "Reconnect").size).toBe(0);
    expect(buildServiceRowActions("tplink_router", "entry-1", [onlineClient], "Reconnect").size).toBe(0);
    expect(buildServiceRowActions("tplink_omada", undefined, [onlineClient], "Reconnect").size).toBe(0);
  });
});
