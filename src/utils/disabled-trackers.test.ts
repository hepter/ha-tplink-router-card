import { describe, expect, it } from "vitest";
import { countIntegrationDisabledTrackers } from "./disabled-trackers";

describe("countIntegrationDisabledTrackers", () => {
  it("counts only trackers the integration disabled", () => {
    expect(
      countIntegrationDisabledTrackers([
        { entity_id: "device_tracker.a", platform: "omada", disabled_by: "integration" },
        { entity_id: "device_tracker.b", platform: "omada", disabled_by: "user" },
        { entity_id: "device_tracker.c", platform: "omada", disabled_by: null },
        { entity_id: "device_tracker.d", platform: "omada" },
        { entity_id: "switch.a_block", platform: "omada", disabled_by: "integration" },
      ]),
    ).toBe(1);
  });

  it("returns zero for an empty registry", () => {
    expect(countIntegrationDisabledTrackers([])).toBe(0);
  });
});
