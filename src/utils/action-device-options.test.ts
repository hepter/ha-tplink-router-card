import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DeviceRegistryEntry } from "../core/types";
import {
  buildActionDeviceOptions,
  type ActionDeviceCandidate,
} from "./action-device-options";

const loadFixture = <T>(name: string): T => {
  const filePath = resolve(process.cwd(), "fixtures", "omada", name);
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
};

describe("buildActionDeviceOptions", () => {
  it("keeps all actionable client targets for omada-style reconnect lists", () => {
    const fixture = loadFixture<{
      actionItems: ActionDeviceCandidate[];
      devices: DeviceRegistryEntry[];
    }>("action_device_dropdown_regression.json");

    const options = buildActionDeviceOptions(fixture.actionItems, fixture.devices);

    expect(options.map((item) => item.deviceName)).toEqual([
      "B-Hyve Hose Tap Timer",
      "B-Hyve Sprinkler Controller",
      "Canon Printer",
      "EAP 650 Access Point 1",
      "EAP 650 Access Point 2",
      "ER707-M2 Router",
      "SG2008P Switch",
    ]);
  });

  it("falls back to device registry naming when action item has no deviceName", () => {
    const actionItems: ActionDeviceCandidate[] = [
      { deviceId: "dev-a", isGlobalCommon: false },
      { deviceId: "dev-b", isGlobalCommon: false },
    ];
    const devices: DeviceRegistryEntry[] = [
      { id: "dev-a", name_by_user: "Named A" },
      { id: "dev-b", name: "Named B" },
    ];

    const options = buildActionDeviceOptions(actionItems, devices);
    expect(options).toEqual([
      { deviceId: "dev-a", deviceName: "Named A" },
      { deviceId: "dev-b", deviceName: "Named B" },
    ]);
  });
});

