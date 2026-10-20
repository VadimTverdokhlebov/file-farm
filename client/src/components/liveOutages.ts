import { ServerHistoryPoint, ServerStatus } from '../types/loadTest';
import type { ServerOutageBand } from './ServerCharts';

function isStopped(server: ServerStatus): boolean {
  return server.running === false || server.status === 'down';
}

// Every stretch of the history in which a server was down, as observed: the strip
// starts at the first sample with the server stopped and ends at the first sample
// with it up again. A server that is down right now has a strip that reaches the
// latest sample and keeps growing. Finished strips stay until they leave the window.
export function liveOutageBands(history: ServerHistoryPoint[]): ServerOutageBand[] {
  const bands: ServerOutageBand[] = [];
  const downSince = new Map<string, number>();

  for (const point of history) {
    for (const server of point.servers) {
      const since = downSince.get(server.name);
      if (isStopped(server)) {
        if (since === undefined) {
          downSince.set(server.name, point.at);
        }
      } else if (since !== undefined) {
        bands.push({ server: server.name, fromMs: since, toMs: point.at });
        downSince.delete(server.name);
      }
    }
  }

  const latest = history[history.length - 1];
  if (latest) {
    for (const [name, since] of downSince) {
      bands.push({ server: name, fromMs: since, toMs: latest.at });
    }
  }
  return bands;
}
