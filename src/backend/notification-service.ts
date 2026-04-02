import nodemailer from 'nodemailer';
import { ProxyAgent } from 'undici';
import { ChangeEvent, AppConfig } from './types.js';

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Self info passed with each notification batch for local node context
export interface SelfInfo {
  hostname: string;
  ips: string[];
  tailnetName: string;
}

// Events that represent meaningful state changes worth notifying about
const NOTIFIABLE_TYPES = new Set([
  'peer_online',
  'peer_offline',
  'exit_node_connected',
  'exit_node_disconnected',
  'exit_node_changed',
  'connection_direct',
  'connection_relay',
  'tailscale_daemon_lost',
  'tailscale_daemon_recovered',
]);

// Hashtags per event type
const EVENT_TAGS: Record<string, string> = {
  peer_online: '#tailscale #status #peer_online',
  peer_offline: '#tailscale #status #peer_offline',
  exit_node_connected: '#tailscale #status #exit_node',
  exit_node_disconnected: '#tailscale #status #exit_node',
  exit_node_changed: '#tailscale #status #exit_node',
  connection_direct: '#tailscale #status #connection',
  connection_relay: '#tailscale #status #connection',
  tailscale_daemon_lost: '#tailscale #status #daemon',
  tailscale_daemon_recovered: '#tailscale #status #daemon',
};

export class NotificationService {
  private config: AppConfig['notifications'];
  private dedupeMap = new Map<string, number>();

  constructor(config: AppConfig['notifications']) {
    this.config = config;
  }

  updateConfig(config: AppConfig['notifications']): void {
    this.config = config;
  }

  private evictExpiredDedupeEntries(): void {
    const cutoff = Date.now() - this.config.dedupe_window_seconds * 2000;
    for (const [key, ts] of this.dedupeMap) {
      if (ts < cutoff) this.dedupeMap.delete(key);
    }
  }

  async notify(events: ChangeEvent[], self?: SelfInfo): Promise<void> {
    this.evictExpiredDedupeEntries();
    // Only send notifiable state-change events
    const toSend = events.filter(e => NOTIFIABLE_TYPES.has(e.type) && this.shouldSend(e));
    if (toSend.length === 0) return;

    for (const event of toSend) {
      this.markSent(event);
    }

    await Promise.allSettled([
      this.sendTelegram(toSend, self),
      this.sendEmail(toSend, self),
    ]);
  }

  private dedupeKey(event: ChangeEvent): string {
    return `${event.type}:${event.peerID ?? ''}`;
  }

  private shouldSend(event: ChangeEvent): boolean {
    const key = this.dedupeKey(event);
    const lastSent = this.dedupeMap.get(key);
    if (!lastSent) return true;
    const windowMs = this.config.dedupe_window_seconds * 1000;
    return Date.now() - lastSent > windowMs;
  }

  private markSent(event: ChangeEvent): void {
    this.dedupeMap.set(this.dedupeKey(event), Date.now());
  }

  private eventIcon(type: string): string {
    const icons: Record<string, string> = {
      peer_online: '🟢',
      peer_offline: '🔴',
      exit_node_connected: '🔒',
      exit_node_disconnected: '🔓',
      exit_node_changed: '🔄',
      connection_direct: '⚡',
      connection_relay: '🔀',
      tailscale_daemon_lost: '💀',
      tailscale_daemon_recovered: '✅',
    };
    return icons[type] ?? 'ℹ️';
  }

  private selfLine(self?: SelfInfo): string {
    if (!self) return '';
    const ip = self.ips.find(i => !i.includes(':')) ?? self.ips[0] ?? '';
    return `📍 ${self.hostname}${ip ? ` (${ip})` : ''}${self.tailnetName ? ` · ${self.tailnetName}` : ''}`;
  }

  private selfLineHtml(self?: SelfInfo): string {
    if (!self) return '';
    const ip = self.ips.find(i => !i.includes(':')) ?? self.ips[0] ?? '';
    return `<div style="font-size:11px;color:#888;margin-bottom:12px">` +
      `📍 Probe: <b>${self.hostname}</b>${ip ? ` · ${ip}` : ''}` +
      `${self.tailnetName ? ` · ${self.tailnetName}` : ''}` +
      `</div>`;
  }

  private formatPlainText(events: ChangeEvent[], self?: SelfInfo): string {
    const lines = events.map(e => {
      const time = new Date(e.timestamp).toLocaleString();
      const tags = EVENT_TAGS[e.type] ?? '#tailscale #status';
      return `[${time}] ${e.message}\n${tags}`;
    });
    const selfLine = this.selfLine(self);
    return (selfLine ? selfLine + '\n\n' : '') + lines.join('\n\n');
  }

  private formatHtml(events: ChangeEvent[], self?: SelfInfo): string {
    const rows = events.map(e => {
      const time = new Date(e.timestamp).toLocaleString();
      const icon = this.eventIcon(e.type);
      const tags = (EVENT_TAGS[e.type] ?? '#tailscale #status')
        .split(' ')
        .map(t => `<span style="color:#7c6ff7;font-size:11px">${t}</span>`)
        .join(' ');
      return `<tr>
        <td style="padding:6px 8px;color:#888;white-space:nowrap;vertical-align:top">${time}</td>
        <td style="padding:6px 8px;vertical-align:top">${icon}</td>
        <td style="padding:6px 8px;vertical-align:top">
          <div>${e.message}</div>
          <div style="margin-top:3px">${tags}</div>
        </td>
      </tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#0f0f1a;color:#e0e0e0;padding:20px">
<h2 style="color:#7c6ff7">Tailscale Probe Alert</h2>
${this.selfLineHtml(self)}
<table style="border-collapse:collapse;width:100%">
${rows}
</table>
</body>
</html>`;
  }

  private async sendTelegram(events: ChangeEvent[], self?: SelfInfo): Promise<void> {
    const cfg = this.config.telegram;
    if (!cfg.enabled || !cfg.bot_token || !cfg.chat_id) return;

    const selfLine = this.selfLine(self);
    const eventLines = events.map(e => {
      const icon = this.eventIcon(e.type);
      const time = new Date(e.timestamp).toLocaleString();
      const tags = EVENT_TAGS[e.type] ?? '#tailscale #status';
      return `${icon} <b>${escHtml(e.message)}</b>\n<i>${escHtml(time)}</i>\n${tags}`;
    }).join('\n\n');

    const text = (selfLine ? `<i>${escHtml(selfLine)}</i>\n\n` : '') + eventLines;

    const url = `https://api.telegram.org/bot${cfg.bot_token}/sendMessage`;
    const body = JSON.stringify({
      chat_id: cfg.chat_id,
      text,
      parse_mode: cfg.parse_mode ?? 'HTML',
    });

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fetchOpts: any = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      };
      if (cfg.proxy) {
        fetchOpts.dispatcher = new ProxyAgent(cfg.proxy);
      }
      const res = await fetch(url, fetchOpts);
      if (!res.ok) {
        const err = await res.text();
        console.error(`Telegram notification failed: ${res.status} ${err}`);
      }
    } catch (err) {
      console.error(`Telegram notification error: ${err}`);
    }
  }

  private async sendEmail(events: ChangeEvent[], self?: SelfInfo): Promise<void> {
    const cfg = this.config.email;
    if (!cfg.enabled || !cfg.smtp_host || !cfg.to?.length) return;

    const transporter = nodemailer.createTransport({
      host: cfg.smtp_host,
      port: cfg.smtp_port,
      secure: cfg.secure,
      auth: cfg.username ? { user: cfg.username, pass: cfg.password } : undefined,
    });

    const prefix = cfg.subject_prefix ?? '[Tailscale Probe]';
    const subject = events.length === 1
      ? `${prefix} ${events[0].message}`
      : `${prefix} ${events.length} network events`;

    try {
      await transporter.sendMail({
        from: cfg.from,
        to: cfg.to.join(', '),
        subject,
        text: this.formatPlainText(events, self),
        html: this.formatHtml(events, self),
      });
    } catch (err) {
      console.error(`Email notification error: ${err}`);
    }
  }
}
