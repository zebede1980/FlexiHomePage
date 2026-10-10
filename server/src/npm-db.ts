// Nginx Proxy Manager keeps its hosts in SQLite; reading it tells us which
// address reaches which container.

import { statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export interface ProxyHost {
  id: number;
  domains: string[];
  host: string;
  port: number;
  scheme: string;
  enabled: boolean;
  ssl: boolean;
}

/** Empty when there is no database at `path` (Compose mounts /dev/null there when none was configured). */
export function readProxyHosts(path: string): ProxyHost[] {
  if (!path || !statSync(path, { throwIfNoEntry: false })?.isFile()) return [];
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = db
      .prepare('SELECT id, domain_names, forward_scheme, forward_host, forward_port, enabled, certificate_id FROM proxy_host WHERE is_deleted = 0 ORDER BY id')
      .all() as unknown as {
      id: number;
      domain_names: string;
      forward_scheme: string;
      forward_host: string;
      forward_port: number;
      enabled: number;
      certificate_id: number | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      domains: JSON.parse(r.domain_names) as string[],
      host: r.forward_host,
      port: r.forward_port,
      scheme: r.forward_scheme,
      enabled: r.enabled === 1,
      ssl: (r.certificate_id ?? 0) > 0,
    }));
  } finally {
    db.close();
  }
}
