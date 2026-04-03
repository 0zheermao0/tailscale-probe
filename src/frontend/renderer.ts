import { store, AppState } from './store.js';
import { renderSelfPanel } from './components/self-panel.js';
import { createNodeCard, updateNodeCard } from './components/node-card.js';
import type { PeerSnapshot, ChangeEvent } from '../backend/types.js';

type SortField = 'hostname' | 'ip' | 'status';
type SortDir = 'asc' | 'desc';
type FilterStatus = 'all' | 'online' | 'offline';

const peersUI = {
  sort: { field: 'status' as SortField, dir: 'asc' as SortDir },
  filter: 'all' as FilterStatus,
  query: '',
};

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
  initPeersToolbar();
}

function initPeersToolbar(): void {
  const toolbar = document.getElementById('peers-toolbar');
  if (!toolbar) return;

  toolbar.innerHTML = `
    <span class="toolbar-label">Sort</span>
    <div class="peers-sort-group">
      <button class="peers-sort-btn active" data-field="status" data-dir="asc">Status</button>
      <button class="peers-sort-btn" data-field="hostname">Name</button>
      <button class="peers-sort-btn" data-field="ip">IP</button>
    </div>
    <div class="peers-toolbar-divider"></div>
    <span class="toolbar-label">Filter</span>
    <div class="peers-filter-group">
      <button class="peers-filter-chip active" data-filter="all">All</button>
      <button class="peers-filter-chip" data-filter="online">Online</button>
      <button class="peers-filter-chip" data-filter="offline">Offline</button>
    </div>
    <input class="peers-search" type="search" placeholder="Search by name or IP…" autocomplete="off" />
  `;

  toolbar.querySelectorAll<HTMLElement>('.peers-sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const field = btn.dataset.field as SortField;
      if (peersUI.sort.field === field) {
        peersUI.sort.dir = peersUI.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        peersUI.sort = { field, dir: 'asc' };
      }
      const state = store.get();
      renderPeers(state.snapshot?.peers ?? [], state.snapshot?.activeExitNodeID ?? null);
    });
  });

  toolbar.querySelectorAll<HTMLElement>('.peers-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      peersUI.filter = chip.dataset.filter as FilterStatus;
      const state = store.get();
      renderPeers(state.snapshot?.peers ?? [], state.snapshot?.activeExitNodeID ?? null);
    });
  });

  toolbar.querySelector<HTMLInputElement>('.peers-search')?.addEventListener('input', (e) => {
    peersUI.query = (e.target as HTMLInputElement).value;
    const state = store.get();
    renderPeers(state.snapshot?.peers ?? [], state.snapshot?.activeExitNodeID ?? null);
  });
}

function applyPeersUI(peers: PeerSnapshot[]): PeerSnapshot[] {
  let result = peers;

  if (peersUI.filter === 'online')  result = result.filter(p => p.online);
  if (peersUI.filter === 'offline') result = result.filter(p => !p.online);

  const q = peersUI.query.trim().toLowerCase();
  if (q) {
    result = result.filter(p =>
      p.hostname.toLowerCase().includes(q) ||
      p.dnsName.toLowerCase().includes(q) ||
      p.ips.some(ip => ip.includes(q))
    );
  }

  const { field, dir } = peersUI.sort;
  result = [...result].sort((a, b) => {
    let cmp = 0;
    if (field === 'status') {
      cmp = (a.online === b.online) ? 0 : a.online ? -1 : 1;
      if (cmp === 0) cmp = a.hostname.localeCompare(b.hostname);
    } else if (field === 'hostname') {
      cmp = a.hostname.localeCompare(b.hostname);
    } else if (field === 'ip') {
      const aip = a.ips.find(i => !i.includes(':')) ?? '';
      const bip = b.ips.find(i => !i.includes(':')) ?? '';
      cmp = aip.localeCompare(bip, undefined, { numeric: true });
    }
    return dir === 'asc' ? cmp : -cmp;
  });

  return result;
}

function updateToolbarUI(): void {
  document.querySelectorAll<HTMLElement>('.peers-sort-btn').forEach(btn => {
    const isActive = btn.dataset.field === peersUI.sort.field;
    btn.classList.toggle('active', isActive);
    btn.dataset.dir = isActive ? peersUI.sort.dir : '';
  });
  document.querySelectorAll<HTMLElement>('.peers-filter-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.filter === peersUI.filter);
  });
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

  const sorted = applyPeersUI(peers);

  const existingCards = new Map<string, HTMLElement>();
  for (const el of grid.querySelectorAll<HTMLElement>('.node-card')) {
    if (el.dataset.peerId) existingCards.set(el.dataset.peerId, el);
  }

  // Remove cards for peers no longer in the list
  const sortedIds = new Set(sorted.map(p => p.id));
  for (const [id, el] of existingCards) {
    if (!sortedIds.has(id)) el.remove();
  }

  // Upsert + reorder: appendChild on an existing child moves it, preserving sort order
  for (const peer of sorted) {
    const isExit = peer.id === activeExitNodeID;
    const existing = existingCards.get(peer.id);
    if (existing) {
      updateNodeCard(existing, peer, isExit);
      grid.appendChild(existing);
    } else {
      grid.appendChild(createNodeCard(peer, isExit));
    }
  }

  if (sorted.length === 0) {
    const msg = peers.length === 0 ? 'No peers found'
      : peersUI.query ? 'No peers match your search'
      : 'No peers match the current filter';
    grid.innerHTML = `<div class="empty-state">${msg}</div>`;
  }

  updateToolbarUI();
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
