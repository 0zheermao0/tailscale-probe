import { resolve } from 'path';
import { ConfigManager } from './config-manager.js';
import { TailscaleClient } from './tailscale-client.js';
import { HeadscaleClient } from './headscale-client.js';
import { Monitor } from './monitor.js';
import { StateStore } from './state-store.js';
import { NotificationService } from './notification-service.js';
import { WebServer } from './web-server.js';
import { ChangeEvent } from './types.js';

const configPath = resolve(process.env.CONFIG_PATH ?? 'config.yaml');
console.log(`Loading config from: ${configPath}`);

const configManager = new ConfigManager(configPath);
const config = configManager.get();

// Port: CLI arg > PORT env var > default 3000. Not in config (requires restart to change).
const portArgIdx = process.argv.findIndex(a => a === '--port' || a === '-p');
const portArg = portArgIdx !== -1
  ? parseInt(process.argv[portArgIdx + 1])
  : parseInt((process.argv.find(a => a.startsWith('--port=')) ?? '').split('=')[1]);
const port = (!isNaN(portArg) && portArg > 0)
  ? portArg
  : parseInt(process.env.PORT ?? '') || 3000;

const client = new TailscaleClient(
  config.monitor.tailscale_socket,
  config.monitor.tailscale_http_addr,
  config.monitor.tailscale_cli
);

const hsClient = new HeadscaleClient(config.headscale.url, config.headscale.api_key);

const monitor = new Monitor(client, config.monitor.interval);
const store = new StateStore(config.monitor.history_size);
const notifier = new NotificationService(config.notifications);
const server = new WebServer(monitor, store, configManager, client, hsClient);

// Wire notifications — include current self info for local node context
monitor.on('change', (events: ChangeEvent[]) => {
  const snap = store.getSnapshot();
  const self = snap ? {
    hostname: snap.self.hostname,
    ips: snap.self.ips,
    tailnetName: snap.tailnetName,
  } : undefined;
  notifier.notify(events, self).catch(err => console.error('Notification error:', err));
});

// Hot-reload config
configManager.on('config_changed', (newConfig: typeof config) => {
  monitor.setInterval(newConfig.monitor.interval);
  store.setMaxHistory(newConfig.monitor.history_size);
  notifier.updateConfig(newConfig.notifications);
  console.log(`Config reloaded: interval=${newConfig.monitor.interval}s`);
});

// Start everything
configManager.startWatching();
await client.probe();
const headscaleAvailable = await hsClient.probe();
console.log(`Headscale: ${headscaleAvailable ? 'detected at ' + config.headscale.url : 'not found'}`);
monitor.start();
await server.start(config.server.host, port);

console.log('Tailscale probe started');
console.log(`Monitor interval: ${config.monitor.interval}s`);
console.log(`Tailscale socket: ${config.monitor.tailscale_socket}`);

// Graceful shutdown
const shutdown = async () => {
  console.log('\nShutting down...');
  monitor.stop();
  configManager.stopWatching();
  await server.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
