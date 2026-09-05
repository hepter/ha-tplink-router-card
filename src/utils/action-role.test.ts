import { describe, expect, it } from "vitest";
import { requiresHoldForAction, resolveActionRole } from "./action-role";

const ctx = (
  overrides: Partial<Parameters<typeof resolveActionRole>[0]>,
): Parameters<typeof resolveActionRole>[0] => ({
  domain: "switch",
  text: "",
  integrationDomain: undefined,
  deviceHasTracker: false,
  ...overrides,
});

const omadaClient = {
  integrationDomain: "omada",
  deviceHasTracker: true,
  entityName: "John Phone",
  deviceName: "John Phone",
};

describe("action role resolution", () => {
  it("keeps the explicit text-based roles", () => {
    expect(resolveActionRole(ctx({ text: "switch.omada_block block" }))).toBe("block");
    expect(resolveActionRole(ctx({ text: "switch.client_blocked blocked" }))).toBe("block");
    expect(resolveActionRole(ctx({ domain: "button", text: "button.reconnect reconnect" }))).toBe(
      "reconnect",
    );
    expect(
      resolveActionRole(ctx({ domain: "button", text: "button.ai start wlan optimization" })),
    ).toBe("wlanOptimization");
    expect(resolveActionRole(ctx({ domain: "button", text: "button.reboot reboot" }))).toBe("reboot");
    expect(resolveActionRole(ctx({ text: "switch.router_wifi_5g wifi 5g" }))).toBe("toggle");
  });

  it("treats the unnamed ha-omada switch on a tracked client as the block switch", () => {
    expect(resolveActionRole(ctx({ text: "switch.john_phone john phone", ...omadaClient }))).toBe(
      "block",
    );
  });

  it("falls back to the device signal alone when the device name is unknown", () => {
    expect(
      resolveActionRole(
        ctx({ text: "switch.john_phone john phone", ...omadaClient, deviceName: undefined }),
      ),
    ).toBe("block");
  });

  it("does not treat a differently named client switch as the block switch", () => {
    expect(
      resolveActionRole(
        ctx({
          text: "switch.john_phone_isolate john phone isolate",
          ...omadaClient,
          entityName: "John Phone Isolate",
        }),
      ),
    ).toBe("toggle");
  });

  it("does not treat infrastructure switches on omada devices as block switches", () => {
    const infra = [
      "switch.eap_2ghz_radio 2.4ghz radio",
      "switch.eap_5ghz_radio 5ghz radio",
      "switch.eap_home_wlan home wlan",
      "switch.eap_ssid_guest guest wlan",
      "switch.sg2210_port_1_poe port 1 poe",
      "switch.er707_wan_connect_ipv4 wan connect ipv4",
      "switch.controller_scanning scanning",
    ];
    for (const text of infra) {
      expect(resolveActionRole(ctx({ text, ...omadaClient, deviceName: undefined })), text).toBe(
        "toggle",
      );
    }
  });

  it("never infers block outside the HACS omada integration or without a tracker", () => {
    expect(
      resolveActionRole(
        ctx({ text: "switch.john_phone john phone", ...omadaClient, integrationDomain: "tplink_omada" }),
      ),
    ).toBe("toggle");
    expect(
      resolveActionRole(
        ctx({ text: "switch.john_phone john phone", ...omadaClient, integrationDomain: "tplink_router" }),
      ),
    ).toBe("toggle");
    expect(
      resolveActionRole(
        ctx({ text: "switch.john_phone john phone", ...omadaClient, deviceHasTracker: false }),
      ),
    ).toBe("toggle");
    expect(
      resolveActionRole(
        ctx({ domain: "button", text: "button.john_phone_custom custom", ...omadaClient }),
      ),
    ).toBe("toggle");
  });
});

describe("hold requirement", () => {
  it("requires hold for destructive roles", () => {
    expect(requiresHoldForAction(ctx({ text: "switch.john_phone john phone" }), "block")).toBe(true);
    expect(requiresHoldForAction(ctx({ domain: "button", text: "reconnect" }), "reconnect")).toBe(true);
    expect(requiresHoldForAction(ctx({ domain: "button", text: "reboot" }), "reboot")).toBe(true);
    expect(
      requiresHoldForAction(ctx({ domain: "button", text: "wlan optimization" }), "wlanOptimization"),
    ).toBe(true);
  });

  it("requires hold for wifi, guest, iot, vpn and dhcp switches but not for scanning", () => {
    expect(requiresHoldForAction(ctx({ text: "switch.router_wifi_5g wifi 5g" }), "toggle")).toBe(true);
    expect(requiresHoldForAction(ctx({ text: "switch.router_guest_24g guest 2.4g" }), "toggle")).toBe(true);
    expect(requiresHoldForAction(ctx({ text: "switch.router_iot_5g iot 5g" }), "toggle")).toBe(true);
    expect(requiresHoldForAction(ctx({ text: "switch.router_openvpn openvpn" }), "toggle")).toBe(true);
    expect(requiresHoldForAction(ctx({ text: "switch.router_vpn_client vpn client" }), "toggle")).toBe(true);
    expect(
      requiresHoldForAction(ctx({ text: "switch.router_lan_ipv4_dhcp_enable lan ipv4 dhcp server" }), "toggle"),
    ).toBe(true);
    expect(requiresHoldForAction(ctx({ text: "switch.router_scanning router data fetching" }), "toggle")).toBe(
      false,
    );
  });

  it("requires hold for port PoE and WAN connect switches because they cut connectivity", () => {
    expect(requiresHoldForAction(ctx({ text: "switch.eap_port_1_poe port 1 poe" }), "toggle")).toBe(true);
    expect(
      requiresHoldForAction(ctx({ text: "switch.er707_wan_connect_ipv4 wan connect ipv4" }), "toggle"),
    ).toBe(true);
  });
});
