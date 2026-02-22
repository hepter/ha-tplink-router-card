import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type JsonObject = Record<string, unknown>;

const loadJson = <T>(relativePath: string): T => {
  const filePath = resolve(process.cwd(), relativePath);
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
};

const normalizeMac = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[^0-9a-f]/gi, "").toLowerCase();
  if (normalized.length !== 12) return null;
  return normalized;
};

describe("virtual modem fixtures", () => {
  it("keeps BE230 cpu/memory as ratios expected by tplink_router integration", () => {
    const fixture = loadJson<{
      status: { cpu_usage?: number; mem_usage?: number };
    }>("virtual_modems/data/tplink_router_be230.json");

    expect(fixture.status.cpu_usage).toBeTypeOf("number");
    expect(fixture.status.mem_usage).toBeTypeOf("number");
    expect(fixture.status.cpu_usage as number).toBeGreaterThanOrEqual(0);
    expect(fixture.status.mem_usage as number).toBeGreaterThanOrEqual(0);
    expect(fixture.status.cpu_usage as number).toBeLessThanOrEqual(1);
    expect(fixture.status.mem_usage as number).toBeLessThanOrEqual(1);
  });

  it("keeps BE230 IoT clients only in smart_network to preserve IoT connection type", () => {
    const fixture = loadJson<{
      clients: {
        smart_network: Array<JsonObject>;
        host: Array<JsonObject>;
        guest: Array<JsonObject>;
        wired: Array<JsonObject>;
      };
    }>("virtual_modems/data/tplink_router_be230.json");

    const hostMacs = new Set(
      fixture.clients.host.map((item) => normalizeMac(item.macaddr)).filter(Boolean) as string[],
    );
    const guestMacs = new Set(
      fixture.clients.guest.map((item) => normalizeMac(item.macaddr)).filter(Boolean) as string[],
    );
    const wiredMacs = new Set(
      fixture.clients.wired.map((item) => normalizeMac(item.macaddr)).filter(Boolean) as string[],
    );

    const iotEntries = fixture.clients.smart_network.filter((item) =>
      String(item.deviceTag ?? "")
        .toLowerCase()
        .startsWith("iot_"),
    );
    expect(iotEntries.length).toBeGreaterThan(0);

    for (const entry of iotEntries) {
      const mac = normalizeMac(entry.mac);
      expect(mac).not.toBeNull();
      expect(hostMacs.has(mac as string)).toBe(false);
      expect(guestMacs.has(mac as string)).toBe(false);
      expect(wiredMacs.has(mac as string)).toBe(false);
    }
  });

  it("uses non-overlapping MAC address spaces across virtual modem profiles", () => {
    const be230 = loadJson<{
      router: JsonObject;
      clients: {
        smart_network: Array<JsonObject>;
        host: Array<JsonObject>;
        guest: Array<JsonObject>;
        wired: Array<JsonObject>;
      };
    }>("virtual_modems/data/tplink_router_be230.json");
    const deco = loadJson<{
      decos: Array<JsonObject>;
      clients: Array<JsonObject>;
    }>("virtual_modems/data/tplink_deco_x50.json");
    const omada = loadJson<{
      devices: Array<JsonObject>;
      clients: Array<JsonObject>;
      known_clients: Array<JsonObject>;
    }>("virtual_modems/data/omada_controller.json");

    const be230Macs = new Set<string>();
    const decoMacs = new Set<string>();
    const omadaMacs = new Set<string>();

    const push = (target: Set<string>, value: unknown) => {
      const mac = normalizeMac(value);
      if (mac) target.add(mac);
    };

    push(be230Macs, be230.router.lan_macaddr);
    push(be230Macs, be230.router.wan_macaddr);
    for (const item of be230.clients.smart_network) push(be230Macs, item.mac);
    for (const item of be230.clients.host) push(be230Macs, item.macaddr);
    for (const item of be230.clients.guest) push(be230Macs, item.macaddr);
    for (const item of be230.clients.wired) push(be230Macs, item.macaddr);

    for (const item of deco.decos) push(decoMacs, item.mac);
    for (const item of deco.clients) push(decoMacs, item.mac);

    for (const item of omada.devices) push(omadaMacs, item.mac);
    for (const item of omada.clients) push(omadaMacs, item.mac);
    for (const item of omada.known_clients) push(omadaMacs, item.mac);

    const be230VsDeco = [...be230Macs].filter((mac) => decoMacs.has(mac));
    const be230VsOmada = [...be230Macs].filter((mac) => omadaMacs.has(mac));
    const decoVsOmada = [...decoMacs].filter((mac) => omadaMacs.has(mac));

    expect(be230VsDeco).toEqual([]);
    expect(be230VsOmada).toEqual([]);
    expect(decoVsOmada).toEqual([]);
  });

  it("keeps Omada virtual fixture large enough to reproduce dropdown scale issues", () => {
    const omada = loadJson<{
      controller: JsonObject;
      devices: Array<JsonObject>;
      clients: Array<JsonObject>;
      known_clients: Array<JsonObject>;
    }>("virtual_modems/data/omada_controller.json");

    expect(String(omada.controller.name ?? "").trim().length).toBeGreaterThan(0);
    expect(omada.devices.length).toBeGreaterThanOrEqual(4);
    expect(omada.clients.length).toBeGreaterThanOrEqual(60);
    expect(omada.known_clients.length).toBe(omada.clients.length);

    const wireless = omada.clients.filter((item) => item.wireless === true);
    const wired = omada.clients.filter((item) => item.wireless === false);
    const guest = omada.clients.filter((item) => item.guest === true);

    expect(wireless.length).toBeGreaterThan(0);
    expect(wired.length).toBeGreaterThan(0);
    expect(guest.length).toBeGreaterThan(0);
  });
});
