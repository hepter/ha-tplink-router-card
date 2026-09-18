import { describe, expect, it } from "vitest";
import { ipSortKey } from "./ip-sort";

const sortIps = (values: string[]) =>
  [...values].sort((a, b) => {
    const ka = ipSortKey(a);
    const kb = ipSortKey(b);
    if (ka === null) return kb === null ? 0 : 1;
    if (kb === null) return -1;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

describe("ipSortKey", () => {
  it("orders IPv4 addresses by octet value instead of by text", () => {
    expect(
      sortIps(["192.168.1.100", "192.168.1.9", "192.168.1.20", "10.0.0.1", "192.168.0.255"]),
    ).toEqual(["10.0.0.1", "192.168.0.255", "192.168.1.9", "192.168.1.20", "192.168.1.100"]);
  });

  it("puts IPv6 after IPv4 and compares expanded groups", () => {
    expect(sortIps(["fe80::1", "2001:db8::10", "192.168.1.1", "2001:db8::2"])).toEqual([
      "192.168.1.1",
      "2001:db8::2",
      "2001:db8::10",
      "fe80::1",
    ]);
    expect(ipSortKey("fe80::1%eth0")).toBe(ipSortKey("fe80::1"));
  });

  it("treats empty cells and 0.0.0.0 as missing and keeps unparsable text last", () => {
    expect(ipSortKey("—")).toBeNull();
    expect(ipSortKey("")).toBeNull();
    expect(ipSortKey(undefined)).toBeNull();
    expect(ipSortKey("0.0.0.0")).toBeNull();
    expect(sortIps(["0.0.0.0", "10.0.0.5", "192.168.1.1"])).toEqual([
      "10.0.0.5",
      "192.168.1.1",
      "0.0.0.0",
    ]);
    expect(ipSortKey("999.1.1.1")?.startsWith("9")).toBe(true);
    expect(sortIps(["n/a", "192.168.1.1", "—"])).toEqual(["192.168.1.1", "n/a", "—"]);
  });
});
