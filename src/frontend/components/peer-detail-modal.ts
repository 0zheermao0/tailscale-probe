import type { PeerSnapshot } from '../../backend/types.js';
import { formatBytes, formatRelativeTime } from './node-card.js';

export function initPeerDetailModal(): void {
  document.addEventListener('peer-detail', (e) => {
    openModal((e as CustomEvent<PeerSnapshot>).detail);
  });
  document.getElementById('peer-modal-overlay')?.addEventListener('click', closeModal);
  document.getElementById('peer-modal-close')?.addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

function openModal(peer: PeerSnapshot): void {
  const modal = document.getElementById('peer-modal');
  const overlay = document.getElementById('peer-modal-overlay');
  const body = document.getElementById('peer-modal-body');
  const title = document.getElementById('peer-modal-title');
  if (!modal || !overlay || !body || !title) return;

  title.innerHTML = buildTitle(peer);
  body.innerHTML = buildBody(peer);

  overlay.classList.add('visible');
  modal.classList.add('visible');
  document.body.style.overflow = 'hidden';
}

function closeModal(): void {
  document.getElementById('peer-modal')?.classList.remove('visible');
  document.getElementById('peer-modal-overlay')?.classList.remove('visible');
  document.body.style.overflow = '';
}

// ── helpers ──────────────────────────────────────────────────────────────────

const OS_ICON: Record<string, string> = {
  linux: '🐧', darwin: '🍎', windows: '🪟', ios: '📱', android: '🤖',
};

function buildTitle(peer: PeerSnapshot): string {
  const icon = OS_ICON[peer.os?.toLowerCase() ?? ''] ?? '💻';
  const statusClass = peer.online ? 'online' : 'offline';
  const statusText = peer.online ? 'Online' : 'Offline';
  return `
    <div class="modal-title-inner">
      <span class="modal-os-icon">${icon}</span>
      <div class="modal-title-text">
        <span class="modal-hostname copyable" data-copy="${peer.hostname}">${peer.hostname}</span>
        <span class="modal-dnsname copyable" data-copy="${peer.dnsName}">${peer.dnsName}</span>
      </div>
      <span class="badge ${statusClass === 'online' ? 'direct' : 'relay'}" style="margin-left:auto">${statusText}</span>
    </div>`;
}

function row(label: string, value: string, copyValue?: string): string {
  if (!value) return '';
  const copyAttr = copyValue !== undefined ? `data-copy="${copyValue}"` : `data-copy="${value}"`;
  return `
    <div class="detail-row">
      <span class="detail-label">${label}</span>
      <span class="detail-value copyable" ${copyAttr}>${value}</span>
    </div>`;
}

function rowRaw(label: string, html: string): string {
  if (!html) return '';
  return `
    <div class="detail-row">
      <span class="detail-label">${label}</span>
      <div class="detail-value">${html}</div>
    </div>`;
}

function section(title: string, content: string): string {
  if (!content.trim()) return '';
  return `
    <div class="detail-section">
      <div class="detail-section-title">${title}</div>
      ${content}
    </div>`;
}

function ipList(ips: string[]): string {
  return ips.map(ip => {
    const cls = ip.includes(':') ? 'ipv6' : 'ipv4';
    return `<span class="ip ${cls} copyable" data-copy="${ip}">${ip}</span>`;
  }).join('');
}

function tagList(tags: string[]): string {
  return `<div class="detail-tags">${tags.map(t =>
    `<span class="detail-tag copyable" data-copy="${t}">${t}</span>`
  ).join('')}</div>`;
}

function fmtTime(iso: string): string {
  if (!iso || iso.startsWith('0001-')) return '—';
  const d = new Date(iso);
  return `${d.toLocaleString()} (${formatRelativeTime(iso)})`;
}

function connStatus(peer: PeerSnapshot): string {
  if (!peer.active) return '<span class="badge" style="opacity:.5">IDLE</span>';
  if (peer.curAddr) return `<span class="badge direct">DIRECT</span> <span class="copyable" data-copy="${peer.curAddr}" style="font-family:var(--font-mono);font-size:12px">${peer.curAddr}</span>`;
  return `<span class="badge relay">RELAY ${peer.relay}</span>`;
}

function buildBody(peer: PeerSnapshot): string {
  // ── Network ──────────────────────────────────────────────────────────────
  const ipv4 = peer.ips.find(ip => !ip.includes(':')) ?? '';
  const ipv6 = peer.ips.find(ip => ip.includes(':')) ?? '';
  const networkContent = `
    ${ipv4 ? row('IPv4', ipv4) : ''}
    ${ipv6 ? row('IPv6', ipv6) : ''}
    ${rowRaw('Connection', connStatus(peer))}
    ${row('Preferred DERP', peer.relay)}
    ${peer.peerRelay ? row('Peer DERP', peer.peerRelay) : ''}
    ${peer.addrs.length ? rowRaw('Public addrs', `<div class="detail-addr-list">${peer.addrs.map(a => `<span class="copyable" data-copy="${a}">${a}</span>`).join('')}</div>`) : ''}
  `;

  // ── Routing ───────────────────────────────────────────────────────────────
  const subnetRoutes = peer.primaryRoutes.filter(r => !peer.ips.some(ip => r.startsWith(ip.split('/')[0])));
  const routingContent = `
    ${subnetRoutes.length ? rowRaw('Subnet routes', ipList(subnetRoutes)) : ''}
    ${peer.isExitNodeOption ? rowRaw('Exit node', '<span class="badge exit-option">Available</span>') : ''}
    ${peer.isExitNode ? rowRaw('Exit node', '<span class="badge exit-active">Active</span>') : ''}
    ${peer.allowedIPs.length ? rowRaw('Allowed IPs', `<div class="detail-addr-list">${peer.allowedIPs.map(ip => `<span class="copyable" data-copy="${ip}">${ip}</span>`).join('')}</div>`) : ''}
  `;

  // ── Traffic ───────────────────────────────────────────────────────────────
  const trafficContent = `
    ${row('Received', formatBytes(peer.rxBytes))}
    ${row('Sent', formatBytes(peer.txBytes))}
  `;

  // ── Timestamps ────────────────────────────────────────────────────────────
  const tsContent = `
    ${row('Created', fmtTime(peer.created))}
    ${row('Last handshake', fmtTime(peer.lastHandshake))}
    ${row('Last seen', fmtTime(peer.lastSeen))}
    ${row('Last write', fmtTime(peer.lastWrite))}
  `;

  // ── Identity ──────────────────────────────────────────────────────────────
  const shortKey = peer.publicKey.replace('nodekey:', '').slice(0, 16) + '…';
  const identityContent = `
    ${row('Node ID', peer.nodeID)}
    ${rowRaw('Public key', `<span class="copyable detail-pubkey" data-copy="${peer.publicKey}" title="${peer.publicKey}">${shortKey}</span>`)}
    ${row('OS', peer.os)}
    ${peer.tags.length ? rowRaw('Tags', tagList(peer.tags)) : ''}
    ${rowRaw('In network map', peer.inNetworkMap ? '✓' : '✗')}
    ${rowRaw('In MagicSock', peer.inMagicSock ? '✓' : '✗')}
    ${rowRaw('In engine', peer.inEngine ? '✓' : '✗')}
  `;

  // ── Capabilities ──────────────────────────────────────────────────────────
  const caps = Object.keys(peer.capMap ?? {});
  const capsContent = caps.length
    ? `<div class="detail-tags">${caps.map(c => {
        const short = c.split('/').pop() ?? c;
        return `<span class="detail-tag copyable" data-copy="${c}" title="${c}">${short}</span>`;
      }).join('')}</div>`
    : '';

  return [
    section('Network', networkContent),
    section('Routing', routingContent),
    section('Traffic', trafficContent),
    section('Timestamps', tsContent),
    section('Identity', identityContent),
    caps.length ? section('Capabilities', capsContent) : '',
  ].join('');
}
