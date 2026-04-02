# Tailscale Probe

A self-hosted Tailscale network monitoring probe with a glassmorphism web UI. Deploy it on any node in your tailnet to get real-time visibility into peer status, connection types, exit nodes, and network events — with optional Telegram and email notifications.

If [Headscale](https://github.com/juanfont/headscale) is running on the same machine, the UI automatically detects it and exposes a full admin panel for managing users, nodes, pre-auth keys, routes, ACL policy, DNS, and API keys.

![UI Preview](https://raw.githubusercontent.com/0zheermao0/tailscale-probe/main/docs/preview.png)

---

## Features

- **Real-time monitoring** — peer online/offline, direct vs relay connections, exit node status, traffic counters
- **Glassmorphism UI** — animated glass-effect dashboard with dark theme
- **Exit node control** — switch exit nodes directly from the sidebar
- **Node detail modal** — click any peer card to inspect all available node information
- **Local node settings** — configure `tailscale set` options (routes, SSH, shields-up, etc.) from the UI
- **Event log** — live change feed with history
- **Notifications** — Telegram bot and SMTP email alerts with deduplication and hashtag tagging
- **Hot-reload config** — edit `config.yaml` and changes apply without restart (except port)
- **Headscale admin panel** — full management UI when Headscale is detected locally
- **macOS compatible** — auto-detects App Store vs standard Tailscale installation

---

## Quick Start

### Prerequisites

- Node.js 20+
- Tailscale installed and running

### Install & Run

```bash
git clone https://github.com/0zheermao0/tailscale-probe.git
cd tailscale-probe
npm install

# Copy and edit config
cp config.example.yaml config.yaml

# Development (hot-reload backend + frontend)
npm run dev        # terminal 1 — backend with tsx watch
npm run dev:ui     # terminal 2 — esbuild frontend watch

# Production build
npm run build
npm start
```

The UI is available at `http://localhost:3000` by default.

### Custom Port

```bash
# Via flag
node dist/backend.js --port 8888

# Via environment variable
PORT=8888 npm start
```

---

## Configuration

Copy `config.example.yaml` to `config.yaml`. All fields except `port` support hot-reload — save the file and changes apply immediately.

```yaml
monitor:
  interval: 10                  # Poll interval in seconds
  tailscale_socket: /var/run/tailscale/tailscaled.sock
  tailscale_http_addr: http://localhost:41112
  # tailscale_cli: /usr/local/bin/tailscale   # Override CLI path (auto-detected)
  history_size: 100             # Events to keep in memory

server:
  host: 0.0.0.0                 # Bind address
  # Port: use --port flag or PORT env var (not hot-reloadable)

headscale:
  url: http://localhost:8080    # Headscale server URL
  api_key: ""                   # Headscale API key (set via Config drawer in UI)

notifications:
  dedupe_window_seconds: 300    # Suppress duplicate alerts within this window

  telegram:
    enabled: false
    bot_token: "YOUR_BOT_TOKEN"
    chat_id: "YOUR_CHAT_ID"
    parse_mode: HTML

  email:
    enabled: false
    smtp_host: smtp.gmail.com
    smtp_port: 587
    secure: false               # true = TLS (port 465), false = STARTTLS
    username: you@gmail.com
    password: "YOUR_APP_PASSWORD"
    from: "Tailscale Probe <you@gmail.com>"
    to:
      - admin@example.com
    subject_prefix: "[Tailscale Probe]"
```

### Config via UI

Click **⚙ Config** in the header to open the configuration drawer. Changes are written to `config.yaml` and take effect immediately. API keys and passwords are masked on read and only updated if a new value is entered.

---

## Notification Format

Notifications are sent only for state-change events:

| Event | Telegram/Email |
|-------|---------------|
| Peer came online | 🟢 |
| Peer went offline | 🔴 |
| Exit node connected | 🔒 |
| Exit node disconnected | 🔓 |
| Exit node changed | 🔄 |
| Switched to direct connection | ⚡ |
| Switched to relay | 🔀 |
| Tailscale daemon lost | 💀 |
| Tailscale daemon recovered | ✅ |

Each message includes:
- The probe node's hostname, Tailscale IP, and tailnet name
- Event description with timestamp
- Hashtags: `#tailscale #status #<event_type>`

---

## Headscale Integration

If Headscale is running on the same host, the probe detects it automatically at startup and shows a **⬡ Headscale** tab in the header.

To authenticate, add your Headscale API key in the Config drawer under **Headscale → API Key**, or set it directly in `config.yaml`.

### Available tabs

| Tab | Operations |
|-----|-----------|
| **Nodes** | List, rename, move to user, tag, expire, delete |
| **Users** | List, create, rename, delete |
| **Pre-auth Keys** | Generate (reusable/ephemeral/tagged), expire |
| **Routes** | View advertised routes and approval status |
| **ACL Policy** | View and edit HuJSON policy |
| **DNS** | MagicDNS toggle, nameservers, search domains, extra records |
| **API Keys** | Create (with optional expiry), expire, delete |

All tables support live search and column sorting.

### CLI command copy

Each management tab includes **$ copy cmd** buttons that copy the equivalent `headscale` CLI command to the clipboard — useful for operations that require the CLI (e.g. approving routes) or when you prefer to script changes directly.

Examples:
- Routes tab: pending route rows show `$ approve` → copies `headscale nodes approve-routes --identifier <id> --routes <prefix>`
- Nodes tab: Expire/Delete actions each have a `$` button → copies `headscale nodes expire/delete --identifier <id>`
- Pre-auth Keys: `$ copy cmd` next to Generate → copies `headscale preauthkeys create --user <id> [flags]`
- Users / API Keys: `$ copy cmd` next to Create → copies the create command with current form values

---

## Tailscale Transport Detection

The probe tries three transports in order and uses the first that succeeds:

1. **Unix socket** — `/var/run/tailscale/tailscaled.sock` (standard Linux/macOS)
2. **HTTP** — `http://localhost:41112` (fallback)
3. **CLI** — `tailscale status --json` (macOS App Store version)

The active transport is logged at startup.

---

## Project Structure

```
tailscale-probe/
├── src/
│   ├── backend/
│   │   ├── index.ts              # Entry point, wires all services
│   │   ├── types.ts              # Shared TypeScript interfaces
│   │   ├── tailscale-client.ts   # Tailscale local API client (socket/HTTP/CLI)
│   │   ├── headscale-client.ts   # Headscale REST API client
│   │   ├── monitor.ts            # Polling loop, change detection, event emission
│   │   ├── web-server.ts         # Fastify HTTP server, SSE, API routes
│   │   ├── state-store.ts        # In-memory snapshot + event history
│   │   ├── notification-service.ts # Telegram + email notifications
│   │   └── config-manager.ts     # YAML config loader with chokidar hot-reload
│   └── frontend/
│       ├── app.ts                # Entry point, DOMContentLoaded init
│       ├── store.ts              # Reactive frontend state
│       ├── renderer.ts           # Main render loop, event delegation
│       ├── sse-client.ts         # EventSource client with auto-reconnect
│       └── components/
│           ├── self-panel.ts     # "This Node" sidebar panel + exit node selector
│           ├── node-card.ts      # Peer grid card component
│           ├── node-settings.ts  # Local node settings (tailscale set)
│           ├── peer-detail-modal.ts # Full node detail modal
│           ├── config-panel.ts   # Config drawer
│           ├── headscale-panel.ts # Headscale tab controller
│           ├── hs-nodes.ts       # Headscale nodes tab
│           ├── hs-users.ts       # Headscale users tab
│           ├── hs-preauth.ts     # Headscale pre-auth keys tab
│           ├── hs-routes.ts      # Headscale routes tab
│           ├── hs-acl.ts         # Headscale ACL policy editor
│           ├── hs-dns.ts         # Headscale DNS config tab
│           ├── hs-apikeys.ts     # Headscale API keys tab
│           └── toast.ts          # Toast notification component
├── public/
│   ├── index.html
│   ├── app.js                    # Bundled frontend (generated)
│   └── styles/
│       ├── base.css              # CSS variables, reset, layout
│       ├── glass.css             # Glassmorphism components
│       └── animations.css        # Keyframe animations
├── dist/                         # Compiled backend (generated)
├── build.ts                      # esbuild frontend bundler script
├── tsconfig.json
├── config.example.yaml
└── package.json
```

---

## Development

```bash
# Type-check only
npm run typecheck

# Build (type-check + compile backend + bundle frontend)
npm run build

# Watch mode (run both in separate terminals)
npm run dev       # backend: tsx watch
npm run dev:ui    # frontend: esbuild watch
```

### Architecture

- **Backend** polls Tailscale every N seconds via `Monitor`, diffs peer state, emits `change` and `snapshot` events
- **WebServer** listens to monitor events, broadcasts to all SSE clients, serves the frontend and REST API
- **Frontend** connects via `EventSource`, updates reactive `store`, re-renders components on each snapshot
- **Config** is loaded from YAML at startup and watched with chokidar; changes propagate to all services without restart

---

## Deployment

### systemd

```ini
[Unit]
Description=Tailscale Probe
After=network.target tailscaled.service

[Service]
Type=simple
WorkingDirectory=/opt/tailscale-probe
ExecStart=/usr/bin/node dist/backend.js
Restart=on-failure
RestartSec=5
Environment=PORT=3000
Environment=CONFIG_PATH=/etc/tailscale-probe/config.yaml

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now tailscale-probe
```

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist/ ./dist/
COPY public/ ./public/
COPY config.example.yaml ./config.yaml
EXPOSE 3000
CMD ["node", "dist/backend.js"]
```

> **Note:** The Docker container needs access to the Tailscale socket. Mount it with `-v /var/run/tailscale:/var/run/tailscale` or set `tailscale_http_addr` to reach the host's Tailscale daemon.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP listen port |
| `CONFIG_PATH` | `config.yaml` | Path to config file |

---

## License

MIT
