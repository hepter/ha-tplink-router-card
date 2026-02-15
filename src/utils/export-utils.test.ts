import { describe, expect, it } from "vitest";
import {
  buildDiagnosticPackage,
  maskMiddle,
  redactExportData,
  redactIp,
  redactMac,
  redactUrl,
  sanitizeForExport,
} from "./export-utils";

describe("export redaction", () => {
  it("masks text but keeps edges", () => {
    expect(maskMiddle("ClientPC")).toBe("Cl***PC");
    expect(maskMiddle("ab")).toBe("a*");
  });

  it("redacts ip and mac", () => {
    expect(redactIp("192.168.1.110")).toBe("192.xxx.xxx.110");
    expect(redactMac("F4-4E-E3-94-DE-28")).toBe("F4-**-**-**-**-28");
  });

  it("redacts url host and query", () => {
    expect(redactUrl("http://192.168.1.1/login?token=abc")).toBe(
      "http://192.xxx.xxx.1/login?***",
    );
  });

  it("recursively redacts sensitive fields and token-like values", () => {
    const input = {
      entry_id: "entry-sample-1",
      local_ip: "192.168.1.1",
      host_name: "ClientPC",
      router_url: "http://192.168.1.1/?auth=abcd",
      auth_blob:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTYifQ.s9M9Y2hhbmdl",
      nested: {
        mac: "F4-4E-E3-94-DE-28",
        safe: "unchanged",
      },
    };
    const out = redactExportData(input);
    expect(out.entry_id).toBe("entry-sample-1");
    expect(out.local_ip).toBe("192.xxx.xxx.1");
    expect(out.host_name).toBe("Cl***PC");
    expect(out.router_url).toBe("http://192.xxx.xxx.1/?***");
    expect(out.auth_blob).toMatch(/\*\*\*/);
    expect(out.nested.mac).toBe("F4-**-**-**-**-28");
    expect(out.nested.safe).toBe("unchanged");
  });

  it("sanitizes circular refs and truncates large payloads", () => {
    const obj: Record<string, unknown> = { name: "root" };
    obj.self = obj;
    obj.items = Array.from({ length: 10 }, (_, i) => `item-${i}`);
    obj.long = "x".repeat(200);
    const out = sanitizeForExport(obj, {
      maxDepth: 4,
      maxArrayLength: 3,
      maxStringLength: 32,
      maxObjectKeys: 20,
      maxNodes: 1000,
    });
    const value = out.value as Record<string, unknown>;
    expect(String(value.self)).toContain("[circular:");
    expect(Array.isArray(value.items)).toBe(true);
    expect((value.items as unknown[]).length).toBe(4);
    expect(String(value.long)).toContain("[truncated:string:");
    expect(out.stats.circularRefs).toBeGreaterThanOrEqual(1);
    expect(out.stats.arrayTruncations).toBeGreaterThanOrEqual(1);
    expect(out.stats.stringTruncations).toBeGreaterThanOrEqual(1);
  });

  it("builds diagnostic package with masked section only", () => {
    const input = {
      ui_state: {
        search: "m11",
        filters: { band: "5g", connection: "wifi", status: "online" },
      },
      state: {
        ip: "192.168.1.110",
        token: "Bearer abcdefghijklmnopqrstuvwxyz",
      },
    };
    const pkg = buildDiagnosticPackage(input, {
      limits: { maxArrayLength: 2, maxNodes: 2000 },
    });
    expect(pkg.schema_version).toBe("1");
    expect(pkg.masked).toBeTruthy();
    const masked = pkg.masked as Record<string, unknown>;
    const maskedState = masked.state as Record<string, unknown>;
    expect(maskedState.ip).toBe("192.xxx.xxx.110");
    expect(String(maskedState.token)).toContain("***");
    expect(pkg.redaction_stats.totalMasked).toBeGreaterThan(0);
  });
});
