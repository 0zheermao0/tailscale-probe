import { store, AppState } from './store.js';
import { renderSelfPanel } from './components/self-panel.js';
import { createNodeCard, updateNodeCard } from './components/node-card.js';
import type { PeerSnapshot, ChangeEvent } from '../backend/types.js';

const EVENT_ICONS: Record<string, string> = {
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

export function initRenderer(): void {
  store.subscribe(render);
  initCopyHandler();
  initPeerClickHandler();
}

function initPeerClickHandler(): void {
  document.getElementById('peers-grid')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-copy]')) return;
    const card = (e.target as HTMLElement).closest<HTMLElement>('.node-card');
    if (!card?.dataset.peerId) return;
    const peer = store.get().snapshot?.peers.find(p => p.id === card.dataset.peerId);
    if (peer) document.dispatchEvent(new CustomEvent('peer-detail', { detail: peer }));
  });
}

function initCopyHandler(): void {
  document.addEventListener('click', async (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-copy]');
    if (!target) return;
    const text = target.dataset.copy ?? '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showCopiedFeedback(target);
    } catch {
      // fallback for non-HTTPS contexts
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showCopiedFeedback(target);
    }
  });
}

function showCopiedFeedback(el: HTMLElement): void {
  if (el.dataset.copying) return;
  el.dataset.copying = '1';
  const prev = el.textContent ?? '';
  el.classList.add('copy-flash');
  el.setAttribute('data-copy-label', '✓');
  setTimeout(() => {
    el.classList.remove('copy-flash');
    el.removeAttribute('data-copy-label');
    delete el.dataset.copying;
  }, 1200);
}

function render(state: AppState): void {
  updateConnectionBadge(state.connected);
  renderSelfPanel(state.snapshot);
  renderPeers(state.snapshot?.peers ?? [], state.snapshot?.activeExitNodeID ?? null);
  renderHistory(state.history);
  updateStats(state.snapshot?.peers ?? []);
}

function updateConnectionBadge(connected: boolean): void {
  const badge = document.getElementById('connection-badge');
  if (!badge) return;
  badge.className = `connection-badge ${connected ? 'connected' : 'disconnected'}`;
  badge.textContent = connected ? 'Connected' : 'Reconnecting...';
}

function updateStats(peers: PeerSnapshot[]): void {
  const onlineCount = peers.filter(p => p.online).length;
  const el = document.getElementById('peer-count');
  if (el) el.textContent = `${onlineCount} / ${peers.length} online`;
}

function renderPeers(peers: PeerSnapshot[], activeExitNodeID: string | null): void {
  const grid = document.getElementById('peers-grid');
  if (!grid) return;

  // Sort: online first, then alphabetically
  const sorted = [...peers].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.hostname.localeCompare(b.hostname);
  });

  const existingCards = new Map<string, HTMLElement>();
  for (const el of grid.querySelectorAll<HTMLElement>('.node-card')) {
    if (el.dataset.peerId) existingCards.set(el.dataset.peerId, el);
  }

  const seen = new Set<string>();
  for (const peer of sorted) {
    seen.add(peer.id);
    const isExit = peer.id === activeExitNodeID;
    const existing = existingCards.get(peer.id);
    if (existing) {
      updateNodeCard(existing, peer, isExit);
    } else {
      const card = createNodeCard(peer, isExit);
      grid.appendChild(card);
    }
  }

  // Remove cards for peers that no longer exist
  for (const [id, el] of existingCards) {
    if (!seen.has(id)) el.remove();
  }

  if (sorted.length === 0) {
    grid.innerHTML = '<div class="empty-state">No peers found</div>';
  }
}

function renderHistory(history: ChangeEvent[]): void {
  const list = document.getElementById('change-log');
  if (!list) return;

  if (history.length === 0) {
    list.innerHTML = '<div class="empty-state">No events yet</div>';
    return;
  }

  list.innerHTML = history.slice(0, 50).map(event => {
    const icon = EVENT_ICONS[event.type] ?? 'ℹ️';
    const time = new Date(event.timestamp).toLocaleTimeString();
    return `<div class="log-entry log-${event.type}">
      <span class="log-icon">${icon}</span>
      <span class="log-msg">${event.message}</span>
      <span class="log-time">${time}</span>
    </div>`;
  }).join('');
}
