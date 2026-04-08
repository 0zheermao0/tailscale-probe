import Fastify, { FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync } from 'fs';
import yaml from 'js-yaml';
import { Monitor } from './monitor.js';
import { StateStore } from './state-store.js';
import { ConfigManager } from './config-manager.js';
import { TailscaleClient } from './tailscale-client.js';
import { HeadscaleClient } from './headscale-client.js';
import { NetworkSnapshot, ChangeEvent, AppConfig } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

type SSEClient = {
  id: string;
  write: (event: string, data: unknown) => void;
  close: () => void;
};

export class WebServer {
  private fastify = Fastify({ logger: false });
  private clients: Map<string, SSEClient> = new Map();
  private monitor: Monitor;
  private store: StateStore;
  private configManager: ConfigManager;
  private tsClient: TailscaleClient;
  private hsClient: HeadscaleClient;

  constructor(
    monitor: Monitor,
    store: StateStore,
    configManager: ConfigManager,
    tsClient: TailscaleClient,
    hsClient: HeadscaleClient
  ) {
    this.monitor = monitor;
    this.store = store;
    this.configManager = configManager;
    this.tsClient = tsClient;
    this.hsClient = hsClient;
    this.setupListeners();
    this.setupRoutes();
  }

  private setupListeners(): void {
    this.monitor.on('snapshot', (snapshot: NetworkSnapshot) => {
      this.store.setSnapshot(snapshot);
      this.broadcast('snapshot', snapshot);
    });

    this.monitor.on('change', (events: ChangeEvent[]) => {
      for (const event of events) {
        this.store.addChange(event);
      }
      this.broadcast('change', events);
    });

    this.configManager.on('config_changed', (config: AppConfig) => {
      this.broadcast('config_updated', { interval: config.monitor.interval });
      this.hsClient.updateConfig(config.headscale.url, config.headscale.api_key);
    });

    this.configManager.on('config_error', (err: Error) => {
      this.broadcast('error', { message: `Config reload failed: ${err.message}` });
    });
  }

  private broadcast(event: string, data: unknown): void {
    for (const client of this.clients.values()) {
      try {
        client.write(event, data);
      } catch {
        this.clients.delete(client.id);
      }
    }
  }

  private setupRoutes(): void {
    const publicDir = join(process.cwd(), 'public');

    this.fastify.register(fastifyStatic, {
      root: publicDir,
      prefix: '/',
    });

    // SSE endpoint
    this.fastify.get('/api/events', (req, reply) => {
      const id = Math.random().toString(36).slice(2);

      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');
      reply.raw.flushHeaders();

      const write = (event: string, data: unknown) => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // Send initial snapshot
      const state = this.store.toJSON();
      write('snapshot', state.snapshot);
      if (state.history.length > 0) {
        write('history', state.history);
      }

      const client: SSEClient = { id, write, close: () => reply.raw.end() };
      this.clients.set(id, client);

      // Keepalive ping every 25s
      const ping = setInterval(() => {
        try {
          reply.raw.write(': ping\n\n');
        } catch {
          clearInterval(ping);
          this.clients.delete(id);
        }
      }, 25000);

      req.raw.on('close', () => {
        clearInterval(ping);
        this.clients.delete(id);
      });

      return reply;
    });

    // Current state
    this.fastify.get('/api/state', async () => {
      return this.store.toJSON();
    });

    // Sanitized config
    this.fastify.get('/api/config', async () => {
      return this.configManager.getSanitized();
    });

    // Update config
    this.fastify.post<{ Body: Partial<AppConfig> }>('/api/config', async (req, reply) => {
      try {
        this.configManager.update(req.body);
        return { ok: true };
      } catch (err) {
        reply.status(500);
        return { ok: false, error: String(err) };
      }
    });

    // Get node prefs
    this.fastify.get('/api/node-prefs', async (_req, reply) => {
      const prefs = await this.tsClient.getPrefs();
      if (!prefs) { reply.status(503); return { error: 'tailscale CLI unavailable' }; }
      return prefs;
    });

    // Set node prefs — body is an array of "--flag=value" strings
    this.fastify.post<{ Body: { flags: string[] } }>('/api/node-prefs', async (req, reply) => {
      const flags = req.body?.flags;
      if (!Array.isArray(flags) || flags.length === 0) {
        reply.status(400); return { ok: false, error: 'flags must be a non-empty array' };
      }
      // Safety: only allow flags that start with --
      const bad = flags.filter(f => !f.startsWith('--'));
      if (bad.length) {
        reply.status(400); return { ok: false, error: `invalid flags: ${bad.join(', ')}` };
      }
      try {
        await this.tsClient.runSet(flags);
        this.monitor.pollNow();
        return { ok: true };
      } catch (err) {
        reply.status(500); return { ok: false, error: String(err) };
      }
    });

    // Set / clear exit node
    this.fastify.post<{ Body: { ip: string } }>('/api/exit-node', async (req, reply) => {
      const ip = (req.body?.ip ?? '').trim();
      try {
        await this.tsClient.setExitNode(ip);
        // Trigger an immediate poll so the UI updates without waiting for the next interval
        this.monitor.pollNow();
        return { ok: true };
      } catch (err) {
        reply.status(500);
        return { ok: false, error: String(err) };
      }
    });

    // ── Headscale proxy routes ──────────────────────────────────────────────

    const hs = this.hsClient;

    // Helper: wrap headscale calls with consistent error shape
    const hsCall = async <T>(reply: FastifyReply, fn: () => Promise<T>) => {
      try {
        return await fn();
      } catch (err) {
        reply.status(502);
        return { ok: false, error: String(err) };
      }
    };

    this.fastify.get('/api/headscale/status', async () => {
      const available = await hs.probe();
      return { available, url: this.configManager.get().headscale.url };
    });

    // Users
    this.fastify.get('/api/headscale/users', async (_req, reply) =>
      hsCall(reply, () => hs.listUsers()));

    this.fastify.post<{ Body: { name: string } }>('/api/headscale/users', async (req, reply) =>
      hsCall(reply, () => hs.createUser(req.body.name)));

    this.fastify.delete<{ Params: { name: string } }>('/api/headscale/users/:name', async (req, reply) =>
      hsCall(reply, async () => { await hs.deleteUser(req.params.name); return { ok: true }; }));

    this.fastify.post<{ Params: { name: string; newName: string } }>(
      '/api/headscale/users/:name/rename/:newName',
      async (req, reply) => hsCall(reply, () => hs.renameUser(req.params.name, req.params.newName))
    );

    // Nodes
    this.fastify.get<{ Querystring: { user?: string } }>('/api/headscale/nodes', async (req, reply) =>
      hsCall(reply, () => hs.listNodes(req.query.user)));

    this.fastify.delete<{ Params: { id: string } }>('/api/headscale/nodes/:id', async (req, reply) =>
      hsCall(reply, async () => { await hs.deleteNode(req.params.id); return { ok: true }; }));

    this.fastify.post<{ Params: { id: string } }>('/api/headscale/nodes/:id/expire', async (req, reply) =>
      hsCall(reply, () => hs.expireNode(req.params.id)));

    this.fastify.post<{ Params: { id: string; name: string } }>(
      '/api/headscale/nodes/:id/rename/:name',
      async (req, reply) => hsCall(reply, () => hs.renameNode(req.params.id, req.params.name))
    );

    this.fastify.post<{ Params: { id: string }; Body: { user: string } }>(
      '/api/headscale/nodes/:id/user',
      async (req, reply) => hsCall(reply, () => hs.moveNode(req.params.id, req.body.user))
    );

    this.fastify.post<{ Params: { id: string }; Body: { tags: string[] } }>(
      '/api/headscale/nodes/:id/tags',
      async (req, reply) => hsCall(reply, () => hs.tagNode(req.params.id, req.body.tags))
    );

    // Routes
    this.fastify.get('/api/headscale/routes', async (_req, reply) =>
      hsCall(reply, () => hs.listRoutes()));

    this.fastify.post<{ Params: { id: string } }>('/api/headscale/routes/:id/enable', async (req, reply) =>
      hsCall(reply, async () => { await hs.enableRoute(req.params.id); return { ok: true }; }));

    this.fastify.post<{ Params: { id: string } }>('/api/headscale/routes/:id/disable', async (req, reply) =>
      hsCall(reply, async () => { await hs.disableRoute(req.params.id); return { ok: true }; }));

    this.fastify.delete<{ Params: { id: string } }>('/api/headscale/routes/:id', async (req, reply) =>
      hsCall(reply, async () => { await hs.deleteRoute(req.params.id); return { ok: true }; }));

    // Pre-auth keys
    this.fastify.get<{ Querystring: { user: string } }>('/api/headscale/preauthkeys', async (req, reply) =>
      hsCall(reply, () => hs.listPreauthKeys(req.query.user)));

    this.fastify.post<{ Body: { user: string; reusable?: boolean; ephemeral?: boolean; expiration?: string; tags?: string[] } }>(
      '/api/headscale/preauthkeys',
      async (req, reply) => hsCall(reply, () => hs.createPreauthKey(req.body.user, {
        reusable: req.body.reusable,
        ephemeral: req.body.ephemeral,
        expiration: req.body.expiration,
        tags: req.body.tags,
      }))
    );

    this.fastify.post<{ Body: { user: string; key: string } }>(
      '/api/headscale/preauthkeys/expire',
      async (req, reply) => hsCall(reply, async () => {
        await hs.expirePreauthKey(req.body.user, req.body.key);
        return { ok: true };
      })
    );

    // ACL policy
    this.fastify.get('/api/headscale/policy', async (_req, reply) =>
      hsCall(reply, () => hs.getPolicy()));

    this.fastify.put<{ Body: { policy: string } }>('/api/headscale/policy', async (req, reply) =>
      hsCall(reply, () => hs.setPolicy(req.body.policy)));

    // DNS
    this.fastify.get('/api/headscale/dns', async (_req, reply) =>
      hsCall(reply, () => hs.getDns()));

    this.fastify.put('/api/headscale/dns', async (req, reply) =>
      hsCall(reply, () => hs.setDns(req.body as Parameters<typeof hs.setDns>[0])));

    // API keys
    this.fastify.get('/api/headscale/apikeys', async (_req, reply) =>
      hsCall(reply, () => hs.listApiKeys()));

    this.fastify.post<{ Body: { expiration?: string } }>('/api/headscale/apikeys', async (req, reply) =>
      hsCall(reply, () => hs.createApiKey(req.body?.expiration)));

    this.fastify.post<{ Params: { prefix: string } }>('/api/headscale/apikeys/:prefix/expire', async (req, reply) =>
      hsCall(reply, async () => { await hs.expireApiKey(req.params.prefix); return { ok: true }; }));

    this.fastify.delete<{ Params: { prefix: string } }>('/api/headscale/apikeys/:prefix', async (req, reply) =>
      hsCall(reply, async () => { await hs.deleteApiKey(req.params.prefix); return { ok: true }; }));

    // ── End headscale routes ────────────────────────────────────────────────

    // Health check
    this.fastify.get('/api/health', async () => {
      return { ok: true, timestamp: new Date().toISOString() };
    });
  }

  async start(host: string, port: number): Promise<void> {
    await this.fastify.listen({ host, port });
    console.log(`Web server listening on http://${host}:${port}`);
  }

  async stop(): Promise<void> {
    for (const client of this.clients.values()) {
      client.close();
    }
    await this.fastify.close();
  }
}
