import { describe, expect, it } from "vitest";
import {
  DEFAULT_HEADER_ACTION_GROUPS,
  HEADER_ACTION_GROUPS,
  matchAction,
  resolveHeaderActionGroups,
} from "./action-matcher";

describe("action matcher", () => {
  it("matches tp-link wifi switches into the wifi, guest and iot groups", () => {
    expect(matchAction("switch", "switch.tp_link_router_wifi_5g", "WIFI 5G")).toEqual({
      kind: "host",
      group: "wifi",
      band: "5g",
      requiresHold: true,
    });
    expect(
      matchAction("switch", "switch.tp_link_router_wifi_guest_24g", "Guest WIFI 2.4G"),
    ).toEqual({
      kind: "guest",
      group: "guest",
      band: "2g",
      requiresHold: true,
    });
    expect(matchAction("switch", "switch.tp_link_router_iot_6g", "IoT WIFI 6G")).toEqual({
      kind: "iot",
      group: "iot",
      band: "6g",
      requiresHold: true,
    });
  });

  it("matches reboot buttons and omada controller buttons", () => {
    expect(matchAction("button", "button.tp_link_router_reboot", "Reboot")).toEqual({
      kind: "router",
      group: "reboot",
      requiresHold: true,
    });
    expect(matchAction("button", "button.omada_reconnect", "Reconnect", "omada")).toEqual({
      kind: "router",
      group: "controller",
      requiresHold: true,
    });
    expect(
      matchAction("button", "button.omada_ai_optimization", "Start WLAN Optimization", "omada"),
    ).toEqual({
      kind: "router",
      group: "controller",
      requiresHold: true,
    });
    expect(matchAction("button", "button.omada_reconnect", "Reconnect")).toBeNull();
    expect(
      matchAction("button", "button.omada_ai_optimization", "Start WLAN Optimization"),
    ).toBeNull();
  });

  it("puts data fetching and deco polling switches into the scanning group without hold", () => {
    expect(
      matchAction("switch", "switch.tp_link_router_scanning", "Router data fetching"),
    ).toEqual({
      kind: "router",
      group: "scanning",
      requiresHold: false,
    });
    expect(matchAction("switch", "switch.deco_polling", "Polling", "tplink_deco")).toEqual({
      kind: "router",
      group: "scanning",
      requiresHold: false,
    });
    expect(matchAction("switch", "switch.deco_polling", "Polling", "tplink_router")).toBeNull();
    expect(matchAction("switch", "switch.omada_block", "Block")).toBeNull();
    expect(matchAction("switch", "switch.omada_ssid_main", "Main WLAN")).toBeNull();
  });

  it("matches tplink_router VPN and DHCP switches into their own hold groups", () => {
    const domain = "tplink_router";
    const vpn = { kind: "router", group: "vpn", requiresHold: true };
    expect(matchAction("switch", "switch.archer_openvpn", "OpenVPN", domain)).toEqual(vpn);
    expect(matchAction("switch", "switch.archer_pptpvpn", "PPTP VPN", domain)).toEqual(vpn);
    expect(matchAction("switch", "switch.archer_ipsec", "IPSec VPN", domain)).toEqual(vpn);
    expect(matchAction("switch", "switch.archer_vpn_client", "VPN Client", domain)).toEqual(vpn);
    expect(
      matchAction("switch", "switch.archer_lan_ipv4_dhcp_enable", "LAN IPv4 DHCP Server", domain),
    ).toEqual({ kind: "router", group: "dhcp", requiresHold: true });
  });

  it("matches core tplink_omada WAN connect switches into the wan group", () => {
    expect(
      matchAction("switch", "switch.er707_wan_connect_ipv4", "WAN connect IPv4", "tplink_omada"),
    ).toEqual({ kind: "router", group: "wan", requiresHold: true });
    expect(
      matchAction("switch", "switch.er707_wan_connect_ipv4", "WAN connect IPv4", "omada"),
    ).toBeNull();
  });

  it("ignores vpn and dhcp switches outside tplink_router", () => {
    expect(matchAction("switch", "switch.archer_openvpn", "OpenVPN")).toBeNull();
    expect(matchAction("switch", "switch.er707_vpn_policy", "VPN Policy", "tplink_omada")).toBeNull();
    expect(matchAction("switch", "switch.deco_dhcp", "DHCP", "tplink_deco")).toBeNull();
  });

  it("does not let vpn or dhcp override guest and iot band switches", () => {
    expect(
      matchAction("switch", "switch.archer_wifi_guest_5g", "Guest WIFI 5G", "tplink_router"),
    ).toEqual({
      kind: "guest",
      group: "guest",
      band: "5g",
      requiresHold: true,
    });
  });
});

describe("header action group configuration", () => {
  it("hides iot, vpn, dhcp and wan by default", () => {
    const groups = resolveHeaderActionGroups(undefined);
    expect([...groups].sort()).toEqual([...DEFAULT_HEADER_ACTION_GROUPS].sort());
    for (const risky of ["iot", "vpn", "dhcp", "wan"]) {
      expect(groups.has(risky as never), risky).toBe(false);
    }
  });

  it("accepts an explicit list, ignores unknown keys and supports all", () => {
    expect([...resolveHeaderActionGroups(["wifi", "dhcp", "bogus"])]).toEqual(["wifi", "dhcp"]);
    expect([...resolveHeaderActionGroups(["ALL"])].sort()).toEqual([...HEADER_ACTION_GROUPS].sort());
    expect(resolveHeaderActionGroups([]).size).toBe(0);
  });
});
