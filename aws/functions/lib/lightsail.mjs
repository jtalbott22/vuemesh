// The Lightsail servers (aws/stun, the STUN and TURN relay): their health for Admin, the month's
// data against the plan's allowance, and the relay's on/off switch (its UDP ports in Lightsail's
// firewall: closed, nothing can be relayed, even with a password; STUN goes on working).
// Nothing here is about the people using them: Lightsail's own metrics, per server.
import {
  LightsailClient, GetInstancesCommand, GetInstanceMetricDataCommand, GetBundlesCommand,
  OpenInstancePublicPortsCommand, CloseInstancePublicPortsCommand,
} from '@aws-sdk/client-lightsail';

export const RELAY_PORTS = { fromPort: 49152, toPort: 49999, protocol: 'udp', cidrs: ['0.0.0.0/0'], ipv6Cidrs: ['::/0'] };
const HOUR = 3600, DAY = 86400;

export function lightsail(client = new LightsailClient({})) {
  let bundles = null;
  const allowanceGb = async (bundleId) => {
    bundles ??= (await client.send(new GetBundlesCommand({ includeInactive: true }))).bundles || [];
    return bundles.find((b) => b.bundleId === bundleId)?.transferPerMonthInGb ?? null;
  };
  const metric = async (instanceName, metricName, statistic, unit, period, start, end) => {
    const r = await client.send(new GetInstanceMetricDataCommand({
      instanceName, metricName, period, startTime: new Date(start * 1000), endTime: new Date(end * 1000), unit, statistics: [statistic],
    }));
    const key = statistic.charAt(0).toLowerCase() + statistic.slice(1);
    return (r.metricData || []).map((d) => ({ t: d.timestamp.getTime(), v: d[key] ?? 0 })).sort((a, b) => a.t - b.t);
  };
  const isRelay = (i) => (i.networking?.ports || []).some((p) => p.fromPort <= 3478 && p.toPort >= 3478);
  const relayOpen = (i) => (i.networking?.ports || []).some((p) => p.protocol === 'udp' && p.fromPort === RELAY_PORTS.fromPort && p.toPort === RELAY_PORTS.toPort);
  const instances = async () => (await client.send(new GetInstancesCommand({}))).instances || [];
  const monthStart = (now) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000; };

  /** The month's data so far (in and out both count against Lightsail's allowance), in GB */
  async function monthGb(name, now) {
    const start = monthStart(now), end = Math.floor(now / 1000);
    const [i, o] = await Promise.all(['NetworkIn', 'NetworkOut'].map((m) => metric(name, m, 'Sum', 'Bytes', DAY, start, end)));
    return [...i, ...o].reduce((s, d) => s + d.v, 0) / 1e9;
  }

  return {
    /** Every server, with the last day hour by hour and the month's data */
    async status(now = Date.now()) {
      const end = Math.floor(now / 1000), start = end - DAY;
      return Promise.all((await instances()).map(async (i) => {
        const name = i.name;
        const [netIn, netOut, cpu, burst, failed, usedGb, allowance] = await Promise.all([
          metric(name, 'NetworkIn', 'Sum', 'Bytes', HOUR, start, end),
          metric(name, 'NetworkOut', 'Sum', 'Bytes', HOUR, start, end),
          metric(name, 'CPUUtilization', 'Average', 'Percent', HOUR, start, end),
          metric(name, 'BurstCapacityPercentage', 'Average', 'Percent', HOUR, start, end),
          metric(name, 'StatusCheckFailed', 'Sum', 'Count', HOUR, start, end),
          monthGb(name, now),
          allowanceGb(i.bundleId),
        ]);
        return {
          name, state: i.state?.name || '?', ip: i.publicIpAddress || null, bundle: i.bundleId, region: i.location?.regionName,
          relay: isRelay(i), relayOpen: isRelay(i) ? relayOpen(i) : null,
          month: { usedGb: Math.round(usedGb * 100) / 100, allowanceGb: allowance, pct: allowance ? Math.round((usedGb / allowance) * 1000) / 10 : null },
          day: { netIn, netOut, cpu, burst, failed },
        };
      }));
    },
    /** The relay server's month, and whether it's switched on (for the API's password check and the guard) */
    async relay(now = Date.now()) {
      const i = (await instances()).find(isRelay);
      if (!i) return null;
      const [usedGb, allowance] = await Promise.all([monthGb(i.name, now), allowanceGb(i.bundleId)]);
      return { name: i.name, open: relayOpen(i), usedGb, allowanceGb: allowance, share: allowance ? usedGb / allowance : 0 };
    },
    /** Switch the relay on or off: its UDP ports in Lightsail's firewall */
    async setRelay(open) {
      const i = (await instances()).find(isRelay);
      if (!i) throw new Error('No relay server');
      if (relayOpen(i) === open) return { name: i.name, open };
      await client.send(new (open ? OpenInstancePublicPortsCommand : CloseInstancePublicPortsCommand)({ instanceName: i.name, portInfo: RELAY_PORTS }));
      return { name: i.name, open };
    },
  };
}
