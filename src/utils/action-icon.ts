import type { ActionRole } from "./action-role";

const ROLE_ICONS: Partial<Record<ActionRole, string>> = {
  block: "mdi:account-cancel",
  reconnect: "mdi:wifi-refresh",
  reboot: "mdi:restart",
  wlanOptimization: "mdi:auto-fix",
};

const TEXT_ICONS: ReadonlyArray<[RegExp, string]> = [
  [/\bled\b|_led\b/, "mdi:led-on"],
  [/\bpoe\b|_poe\b/, "mdi:ethernet"],
  [/locate/, "mdi:map-marker-radius"],
  [/speed.?test/, "mdi:speedometer"],
  [/firmware|upgrade/, "mdi:update"],
  [/data fetching|scanning|polling/, "mdi:sync"],
  [/refresh/, "mdi:refresh"],
  [/vpn/, "mdi:vpn"],
  [/dhcp/, "mdi:ip-network"],
  [/\bwan\b|wan_connect|e-wan/, "mdi:wan"],
  [/wifi|wlan|radio|ssid|\bmlo\b|_mlo_/, "mdi:wifi"],
];

// Integrations that moved their icons to icons.json publish no `icon` attribute.
export const resolveActionIcon = (
  attrIcon: unknown,
  domain: "switch" | "button",
  role: ActionRole,
  text: string,
): string => {
  if (typeof attrIcon === "string" && attrIcon.trim().length > 0) return attrIcon;
  const roleIcon = ROLE_ICONS[role];
  if (roleIcon) return roleIcon;
  const match = TEXT_ICONS.find(([pattern]) => pattern.test(text));
  if (match) return match[1];
  return domain === "button" ? "mdi:gesture-tap-button" : "mdi:toggle-switch";
};
