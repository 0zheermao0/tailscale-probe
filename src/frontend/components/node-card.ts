import type { PeerSnapshot } from '../../backend/types.js';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatRelativeTime(isoString: string): string {
  if (!isoString) return 'never';
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 0) return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export function createNodeCard(peer: PeerSnapshot, isExitActive: boolean): HTMLElement {
  const card = document.createElement('div');
  card.className = `glass-card node-card ${peer.online ? 'online' : 'offline'}`;
  card.dataset.peerId = peer.id;
  card.innerHTML = buildCardHTML(peer, isExitActive);
  return card;
}

export function updateNodeCard(card: HTMLElement, peer: PeerSnapshot, isExitActive: boolean): void {
  const wasOnline = card.classList.contains('online');
  card.classList.toggle('online', peer.online);
  card.classList.toggle('offline', !peer.online);

  if (wasOnline !== peer.online) {
    card.classList.add('status-changed');
    setTimeout(() => card.classList.remove('status-changed'), 1000);
  }

  card.innerHTML = buildCardHTML(peer, isExitActive);
}

function buildCardHTML(peer: PeerSnapshot, isExitActive: boolean): string {
  const ipv4 = peer.ips.find(ip => !ip.includes(':')) ?? '';
  const ipv6 = peer.ips.find(ip => ip.includes(':')) ?? '';
  // CurAddr non-empty = direct; Active + no CurAddr = relay; otherwise no active tunnel
  const connectionType = peer.active
    ? peer.curAddr
      ? `<span class="badge direct">DIRECT <span class="addr">${peer.curAddr}</span></span>`
      : `<span class="badge relay">RELAY <span class="relay-name">${peer.relay}</span></span>`
    : '';

  const exitBadge = isExitActive
    ? `<span class="badge exit-active">EXIT NODE</span>`
    : peer.isExitNodeOption
    ? `<span class="badge exit-option">EXIT OPTION</span>`
    : '';

  const osIcon: Record<string, string> = {
    linux: '🐧', darwin: '🍎', windows: '🪟', ios: '📱', android: '🤖',
  };
  const osEmoji = osIcon[peer.os?.toLowerCase() ?? ''] ?? '💻';

  const lastSeen = peer.online ? 'now' : formatRelativeTime(peer.lastSeen);

  return `
    <div class="node-header">
      <div class="node-title">
        <span class="os-icon">${osEmoji}</span>
        <span class="node-name copyable" data-copy="${peer.hostname || peer.dnsName}">${peer.hostname || peer.dnsName}</span>
      </div>
      <div class="status-dot ${peer.online ? 'online' : 'offline'}"></div>
    </div>
    <div class="node-dns copyable" data-copy="${peer.dnsName}">${peer.dnsName}</div>
    <div class="node-ips">
      ${ipv4 ? `<span class="ip ipv4 copyable" data-copy="${ipv4}">${ipv4}</span>` : ''}
      ${ipv6 ? `<span class="ip ipv6 copyable" data-copy="${ipv6}">${ipv6}</span>` : ''}
    </div>
    ${connectionType || exitBadge ? `<div class="node-badges">${connectionType}${exitBadge}</div>` : ''}
    <div class="node-meta">
      <span class="meta-item">
        <span class="meta-label">Seen</span>
        <span class="meta-value">${lastSeen}</span>
      </span>
      <span class="meta-item">
        <span class="meta-label">RX</span>
        <span class="meta-value">${formatBytes(peer.rxBytes)}</span>
      </span>
      <span class="meta-item">
        <span class="meta-label">TX</span>
        <span class="meta-value">${formatBytes(peer.txBytes)}</span>
      </span>
    </div>
  `;
}
