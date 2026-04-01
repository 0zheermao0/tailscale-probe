import type { NetworkSnapshot, PeerSnapshot } from '../../backend/types.js';
import { formatBytes } from './node-card.js';
import { showToast } from './toast.js';

let pendingExitNode = false;
let exitNodeDelegateAttached = false;

export function renderSelfPanel(snapshot: NetworkSnapshot | null): void {
  const panel = document.getElementById('self-panel');
  if (!panel) return;

  // Attach exit-node click delegation once; innerHTML replacement doesn't re-add listeners
  if (!exitNodeDelegateAttached) {
    exitNodeDelegateAttached = true;
    panel.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>('.exit-option-item');
      if (!item || pendingExitNode) return;
      setExitNode(item.dataset.ip ?? '', item.dataset.name ?? '');
    });
  }

  if (!snapshot || !snapshot.daemonRunning) {
    panel.innerHTML = `
      <div class="daemon-error glass-card">
        <span class="error-icon">⚠</span>
        <span>Tailscale daemon unreachable</span>
      </div>`;
    return;
  }

  const self = snapshot.self;
  const ipv4 = self.ips.find(ip => !ip.includes(':')) ?? '';
  const ipv6 = self.ips.find(ip => ip.includes(':')) ?? '';

  const exitOptions = snapshot.peers.filter(p => p.isExitNodeOption);
  const activeExit = snapshot.activeExitNodeID
    ? snapshot.peers.find(p => p.id === snapshot.activeExitNodeID)
    : null;

  const connType = self.active
    ? self.curAddr
      ? `<span class="badge direct">DIRECT · ${self.curAddr}</span>`
      : `<span class="badge relay">RELAY ${self.relay}</span>`
    : `<span class="badge" style="opacity:.5">IDLE</span>`;

  panel.innerHTML = `
    <div class="self-header">
      <div class="self-title">
        <span class="self-hostname copyable" data-copy="${self.hostname}">${self.hostname}</span>
        <span class="self-login copyable" data-copy="${self.loginName}">${self.loginName}</span>
      </div>
      <div class="self-state ${snapshot.backendState === 'Running' ? 'running' : 'stopped'}">
        ${snapshot.backendState}
      </div>
    </div>
    <div class="self-tailnet copyable" data-copy="${snapshot.tailnetName}">${snapshot.tailnetName}</div>
    <div class="self-ips">
      ${ipv4 ? `<span class="ip ipv4 copyable" data-copy="${ipv4}">${ipv4}</span>` : ''}
      ${ipv6 ? `<span class="ip ipv6 copyable" data-copy="${ipv6}">${ipv6}</span>` : ''}
    </div>
    <div class="self-connection">
      ${connType}
    </div>
    ${buildExitNodeSelector(exitOptions, activeExit, snapshot.exitNodeStatus?.Online ?? false)}
    <div class="self-traffic">
      <span class="traffic-item">↓ ${formatBytes(self.rxBytes)}</span>
      <span class="traffic-item">↑ ${formatBytes(self.txBytes)}</span>
    </div>
  `;

  // Attach click handlers to exit node option items
  panel.querySelectorAll<HTMLElement>('.exit-option-item').forEach(el => {
    el.addEventListener('click', () => {
      if (pendingExitNode) return;
      const ip = el.dataset.ip ?? '';
      const name = el.dataset.name ?? '';
      setExitNode(ip, name);
    });
  });
}

function buildExitNodeSelector(
  options: PeerSnapshot[],
  active: PeerSnapshot | null,
  activeOnline: boolean,
): string {
  const noneActive = !active;

  const noneItem = `
    <div class="exit-option-item ${noneActive ? 'active' : ''}" data-ip="" data-name="None">
      <span class="exit-option-icon">${noneActive ? '●' : '○'}</span>
      <span class="exit-option-name">None</span>
      ${noneActive ? '<span class="exit-option-check">✓</span>' : ''}
    </div>`;

  const items = options.map(p => {
    const isActive = p.id === active?.id;
    const ip = p.ips.find(i => !i.includes(':')) ?? p.ips[0] ?? '';
    return `
      <div class="exit-option-item ${isActive ? 'active' : ''} ${!p.online ? 'offline' : ''}"
           data-ip="${ip}" data-name="${p.hostname}">
        <span class="exit-option-icon">${isActive ? '●' : '○'}</span>
        <span class="exit-option-name">${p.hostname}</span>
        <span class="exit-option-ip">${ip}</span>
        ${isActive
          ? `<span class="exit-option-status ${activeOnline ? 'online' : 'offline'}"></span>`
          : `<span class="exit-option-status ${p.online ? 'online' : 'offline'}"></span>`}
      </div>`;
  }).join('');

  return `
    <div class="exit-node-selector">
      <div class="exit-node-selector-label">
        <span>Exit Node</span>
        ${pendingExitNode ? '<span class="exit-pending">applying…</span>' : ''}
      </div>
      <div class="exit-node-options">
        ${noneItem}
        ${items || '<div class="exit-no-options">No exit nodes available</div>'}
      </div>
    </div>`;
}

async function setExitNode(ip: string, name: string): Promise<void> {
  pendingExitNode = true;
  // Re-render to show "applying…" immediately — store will call renderSelfPanel again
  document.dispatchEvent(new CustomEvent('exit-node-pending'));

  try {
    const res = await fetch('/api/exit-node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip }),
    });
    const data = await res.json() as { ok: boolean; error?: string };
    if (data.ok) {
      showToast(ip ? `Exit node set to ${name}` : 'Exit node cleared', 'success');
    } else {
      showToast(`Failed: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Request failed: ${err}`, 'error');
  } finally {
    pendingExitNode = false;
  }
}
