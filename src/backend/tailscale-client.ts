import http from 'http';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { TailscaleStatus, TailscalePrefs } from './types.js';

const execFileAsync = promisify(execFile);

// Candidate socket paths (Linux standard, macOS non-App-Store)
const SOCKET_CANDIDATES = [
  '/var/run/tailscale/tailscaled.sock',
  '/run/tailscale/tailscaled.sock',
];

// Candidate CLI paths in priority order
const CLI_CANDIDATES = [
  '/usr/local/bin/tailscale',
  '/usr/bin/tailscale',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
];

type TransportType = 'socket' | 'http' | 'cli';

interface Transport {
  type: TransportType;
  label: string;
  fetch: () => Promise<TailscaleStatus>;
}

function httpGet(options: http.RequestOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        } else {
          resolve(body);
        }
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function trySocket(socketPath: string): Promise<TailscaleStatus> {
  const body = await httpGet({
    socketPath,
    path: '/localapi/v0/status',
    method: 'GET',
    headers: { Host: 'local-tailscaled.sock' },
  });
  return JSON.parse(body) as TailscaleStatus;
}

async function tryHttp(addr: string): Promise<TailscaleStatus> {
  const url = new URL('/localapi/v0/status', addr);
  const body = await httpGet({
    hostname: url.hostname,
    port: parseInt(url.port || '80'),
    path: url.pathname,
    method: 'GET',
  });
  return JSON.parse(body) as TailscaleStatus;
}

async function tryCli(cli: string): Promise<TailscaleStatus> {
  const { stdout } = await execFileAsync(cli, ['status', '--json'], { timeout: 5000 });
  return JSON.parse(stdout) as TailscaleStatus;
}

export class TailscaleClient {
  private configSocketPath: string;
  private configHttpAddr: string;
  private configCliPath: string;

  // Resolved at first successful call, reused for subsequent polls
  private activeTransport: Transport | null = null;

  constructor(socketPath: string, httpAddr: string, cliPath = '') {
    this.configSocketPath = socketPath;
    this.configHttpAddr = httpAddr;
    this.configCliPath = cliPath;
  }

  /**
   * Probe all available transports once and log which one works.
   * Call this at startup for a clear diagnostic message.
   */
  async probe(): Promise<void> {
    const transport = await this.resolveTransport();
    if (transport) {
      console.log(`Tailscale transport: ${transport.type} (${transport.label})`);
    } else {
      console.warn('Tailscale: no working transport found (daemon may not be running)');
    }
  }

  async getStatus(): Promise<TailscaleStatus | null> {
    // Fast path: reuse known-good transport
    if (this.activeTransport) {
      try {
        return await this.activeTransport.fetch();
      } catch {
        // Transport broke — re-probe next call
        this.activeTransport = null;
      }
    }

    const transport = await this.resolveTransport();
    if (!transport) return null;
    this.activeTransport = transport;
    try {
      return await transport.fetch();
    } catch {
      this.activeTransport = null;
      return null;
    }
  }

  private buildTransports(): Transport[] {
    const transports: Transport[] = [];

    // Socket candidates
    const socketPaths = this.configSocketPath
      ? [this.configSocketPath, ...SOCKET_CANDIDATES.filter(p => p !== this.configSocketPath)]
      : SOCKET_CANDIDATES;

    for (const sp of socketPaths) {
      if (existsSync(sp)) {
        transports.push({
          type: 'socket',
          label: sp,
          fetch: () => trySocket(sp),
        });
      }
    }

    // HTTP
    transports.push({
      type: 'http',
      label: this.configHttpAddr,
      fetch: () => tryHttp(this.configHttpAddr),
    });

    // CLI candidates
    const cliPaths = this.configCliPath
      ? [this.configCliPath, ...CLI_CANDIDATES.filter(p => p !== this.configCliPath)]
      : CLI_CANDIDATES;

    for (const cli of cliPaths) {
      if (existsSync(cli)) {
        transports.push({
          type: 'cli',
          label: cli,
          fetch: () => tryCli(cli),
        });
      }
    }

    return transports;
  }

  private async resolveTransport(): Promise<Transport | null> {
    for (const transport of this.buildTransports()) {
      try {
        await transport.fetch();
        return transport;
      } catch {
        // try next
      }
    }
    return null;
  }

  /** Get current node preferences via `tailscale debug prefs`. */
  async getPrefs(): Promise<TailscalePrefs | null> {
    const cli = this.resolveCli();
    if (!cli) return null;
    try {
      const { stdout } = await execFileAsync(cli, ['debug', 'prefs'], { timeout: 5000 });
      return JSON.parse(stdout) as TailscalePrefs;
    } catch {
      return null;
    }
  }

  /** Run `tailscale set` with arbitrary flags. Each entry is a `--flag=value` string. */
  async runSet(flags: string[]): Promise<void> {
    const cli = this.resolveCli();
    if (!cli) throw new Error('No tailscale CLI found');
    const { stderr } = await execFileAsync(cli, ['set', ...flags], { timeout: 8000 });
    if (stderr) throw new Error(stderr.trim());
    this.activeTransport = null;
  }

  /** Set or clear the exit node. Pass empty string to disconnect. */
  async setExitNode(ip: string): Promise<void> {
    return this.runSet([`--exit-node=${ip}`]);
  }

  private resolveCli(): string | null {
    const candidates = this.configCliPath
      ? [this.configCliPath, ...CLI_CANDIDATES.filter(p => p !== this.configCliPath)]
      : CLI_CANDIDATES;
    return candidates.find(p => existsSync(p)) ?? null;
  }
}
