// Integrations that set has_entity_name with the device name as entity name make Home Assistant
// render "<device> <device> …"; drop the repeated device name.
export const collapseDoubledDeviceName = (
  name: string,
  deviceName: string | undefined,
): string => {
  const base = (deviceName ?? "").trim();
  const value = name.trim();
  if (base.length === 0 || value.length === 0) return name;
  const doubled = `${base} ${base}`;
  if (value === doubled) return base;
  if (value.startsWith(`${doubled} `)) return `${base}${value.slice(doubled.length)}`;
  return name;
};
