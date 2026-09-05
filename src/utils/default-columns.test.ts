import { describe, expect, it } from "vitest";
import { selectDefaultColumnKeys } from "./default-columns";

const ordered = ["name", "status", "band", "apName", "ip", "channel", "wifiMode", "lastSeen", "actions"];
const allowed = new Set(["name", "status", "band", "apName", "ip", "channel", "wifiMode", "lastSeen"]);

describe("default column selection", () => {
  it("keeps opt-in columns out of the defaults even when the domain allows them", () => {
    expect(selectDefaultColumnKeys(ordered, allowed)).toEqual(["name", "status", "band", "ip"]);
  });

  it("preserves the registry order for the remaining columns", () => {
    expect(selectDefaultColumnKeys(["ip", "name", "status"], allowed)).toEqual(["ip", "name", "status"]);
  });

  it("never adds keys outside the allowed set", () => {
    expect(selectDefaultColumnKeys(ordered, allowed)).not.toContain("actions");
  });
});
