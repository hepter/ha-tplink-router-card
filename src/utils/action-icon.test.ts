import { describe, expect, it } from "vitest";
import { resolveActionIcon } from "./action-icon";

describe("resolveActionIcon", () => {
  it("keeps the icon the integration publishes", () => {
    expect(resolveActionIcon("mdi:custom", "switch", "toggle", "switch.x wifi 5g")).toBe("mdi:custom");
  });

  it("falls back to role icons when the attribute is missing", () => {
    expect(resolveActionIcon(undefined, "switch", "block", "switch.phone_network_access")).toBe(
      "mdi:account-cancel",
    );
    expect(resolveActionIcon(undefined, "button", "reconnect", "button.phone_reconnect")).toBe(
      "mdi:wifi-refresh",
    );
    expect(resolveActionIcon("", "button", "reboot", "button.ap_reboot")).toBe("mdi:restart");
    expect(
      resolveActionIcon(undefined, "button", "wlanOptimization", "button.site_wlan_optimization"),
    ).toBe("mdi:auto-fix");
  });

  it("derives toggle icons from the entity text", () => {
    expect(resolveActionIcon(undefined, "switch", "toggle", "switch.eap670_led eap670 led")).toBe(
      "mdi:led-on",
    );
    expect(resolveActionIcon(undefined, "switch", "toggle", "switch.core_port_1_poe port 1 poe")).toBe(
      "mdi:ethernet",
    );
    expect(
      resolveActionIcon(undefined, "switch", "toggle", "switch.eap670_5_ghz_radio 5 ghz radio"),
    ).toBe("mdi:wifi");
    expect(
      resolveActionIcon(undefined, "button", "toggle", "button.deco_refresh_deco_status refresh deco status"),
    ).toBe("mdi:refresh");
    expect(
      resolveActionIcon(undefined, "switch", "toggle", "switch.tp_link_router_e_wan_connect e-wan connect"),
    ).toBe("mdi:wan");
  });

  it("keeps the generic icons for anything else", () => {
    expect(resolveActionIcon(undefined, "switch", "toggle", "switch.something other")).toBe(
      "mdi:toggle-switch",
    );
    expect(resolveActionIcon(undefined, "button", "toggle", "button.something other")).toBe(
      "mdi:gesture-tap-button",
    );
  });

  it("does not read led out of unrelated words", () => {
    expect(resolveActionIcon(undefined, "switch", "toggle", "switch.controlled_outlet controlled outlet")).toBe(
      "mdi:toggle-switch",
    );
  });
});
