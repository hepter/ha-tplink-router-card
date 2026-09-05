import { describe, expect, it } from "vitest";
import {
  ALL_COLUMN_KEYS,
  COMMON_COLUMN_KEYS,
  OPT_IN_COLUMN_KEYS,
  getAllowedColumnsForDomain,
} from "./integration-profile";

describe("integration column profiles", () => {
  it("exposes the access point column to every tracker-based integration except core tplink_omada", () => {
    expect(COMMON_COLUMN_KEYS).toContain("apName");
    expect(getAllowedColumnsForDomain("tplink_router")).toContain("apName");
    expect(getAllowedColumnsForDomain("tplink_deco")).toContain("apName");
    expect(getAllowedColumnsForDomain("omada")).toContain("apName");
    expect(getAllowedColumnsForDomain("tplink_omada")).not.toContain("apName");
  });

  it("keeps the access point column right after band in the default order", () => {
    const keys = [...COMMON_COLUMN_KEYS];
    expect(keys.indexOf("apName")).toBe(keys.indexOf("band") + 1);
  });

  it("adds channel, wifi mode and last seen only for the HACS omada integration", () => {
    for (const key of ["channel", "wifiMode", "lastSeen", "snr", "powerSave", "downloaded", "uploaded"]) {
      expect(getAllowedColumnsForDomain("omada"), key).toContain(key);
      expect(getAllowedColumnsForDomain("tplink_omada"), key).not.toContain(key);
      expect(getAllowedColumnsForDomain("tplink_router"), key).not.toContain(key);
    }
  });

  it("keeps device metadata and actions for core tplink_omada device rows", () => {
    const allowed = getAllowedColumnsForDomain("tplink_omada");
    for (const key of ["deviceType", "deviceModel", "deviceFirmware", "deviceStatus", "actions"]) {
      expect(allowed, key).toContain(key);
    }
  });

  it("lists every column key once in ALL_COLUMN_KEYS", () => {
    const unique = new Set(ALL_COLUMN_KEYS);
    expect(unique.size).toBe(ALL_COLUMN_KEYS.length);
    for (const key of ["apName", "channel", "wifiMode", "lastSeen"]) {
      expect(unique.has(key as (typeof ALL_COLUMN_KEYS)[number]), key).toBe(true);
    }
  });

  it("marks every newly added column as opt-in", () => {
    expect([...OPT_IN_COLUMN_KEYS].sort()).toEqual(["apName", "channel", "lastSeen", "wifiMode"]);
    for (const key of OPT_IN_COLUMN_KEYS) {
      expect(ALL_COLUMN_KEYS, key).toContain(key);
    }
  });

  it("falls back to the common set for unknown domains", () => {
    expect(getAllowedColumnsForDomain(undefined)).toEqual(COMMON_COLUMN_KEYS);
    expect(getAllowedColumnsForDomain("something_else")).toEqual(COMMON_COLUMN_KEYS);
  });
});
