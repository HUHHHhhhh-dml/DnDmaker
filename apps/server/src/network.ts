import { networkInterfaces } from "node:os";

/** IPs LAN utilizables para compartir el link de la mesa. */
export function getLanIps(): string[] {
  const interfaces = networkInterfaces();
  const addresses: string[] = [];

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (entry.address.startsWith("169.254.")) continue;
      addresses.push(entry.address);
    }
  }

  const privateFirst = (address: string): number => {
    if (address.startsWith("192.168.")) return 0;
    if (address.startsWith("10.")) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
    return 3;
  };

  return [...new Set(addresses)].sort((a, b) => {
    const byKind = privateFirst(a) - privateFirst(b);
    return byKind !== 0 ? byKind : a.localeCompare(b);
  });
}
