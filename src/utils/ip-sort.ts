const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const expandIpv6 = (value: string): string | null => {
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
  return groups.map((group) => group.toLowerCase().padStart(4, "0")).join("");
};

// Fixed-width keys so that plain string comparison orders IPv4 by octet value, then IPv6,
// then anything unparsable; empty cells sort as missing.
export const ipSortKey = (value: unknown): string | null => {
  const text = String(value ?? "").trim();
  // Routers report 0.0.0.0 for clients without a lease; that is "no address", not the lowest one.
  if (text.length === 0 || text === "—" || text === "0.0.0.0") return null;
  const ipv4 = IPV4_PATTERN.exec(text);
  if (ipv4) {
    const octets = ipv4.slice(1, 5).map(Number);
    if (octets.every((octet) => octet <= 255)) {
      return `4${octets.map((octet) => String(octet).padStart(3, "0")).join("")}`;
    }
  }
  if (text.includes(":")) {
    const expanded = expandIpv6(text.split("%")[0]);
    if (expanded) return `6${expanded}`;
  }
  return `9${text.toLowerCase()}`;
};
