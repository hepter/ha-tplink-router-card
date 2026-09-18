import { describe, expect, it } from "vitest";
import { collapseDoubledDeviceName } from "./entity-name";

describe("collapseDoubledDeviceName", () => {
  it("collapses an exactly doubled device name", () => {
    expect(collapseDoubledDeviceName("vm-phone-001 vm-phone-001", "vm-phone-001")).toBe(
      "vm-phone-001",
    );
  });

  it("collapses a doubled device name prefix and keeps the entity name", () => {
    expect(
      collapseDoubledDeviceName(
        "Virtual EAP670 Hall Virtual EAP670 Hall LED",
        "Virtual EAP670 Hall",
      ),
    ).toBe("Virtual EAP670 Hall LED");
  });

  it("leaves other names untouched", () => {
    expect(collapseDoubledDeviceName("vm-phone-001 RSSI", "vm-phone-001")).toBe(
      "vm-phone-001 RSSI",
    );
    expect(collapseDoubledDeviceName("John Phone", "John")).toBe("John Phone");
    expect(collapseDoubledDeviceName("John John", undefined)).toBe("John John");
    expect(collapseDoubledDeviceName("John Johnson", "John")).toBe("John Johnson");
  });
});
