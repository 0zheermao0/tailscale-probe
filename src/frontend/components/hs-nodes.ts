import type { HeadscaleNode, HeadscaleUser } from '../../backend/types.js';
import { showToast } from './toast.js';
import { showConfirm, showInput } from './dialog.js';
import { makeTableState, sortTh, searchInput, wireSearch, wireSortHeaders, type TableState } from './table-utils.js';

export async function renderHsNodes(container: HTMLElement): Promise<void> {
  const [nodesRes, usersRes] = await Promise.all([
    fetch('/api/headscale/nodes'),
    fetch('/api/headscale/users'),
  ]);
  const nodesData = await nodesRes.json() as HeadscaleNode[] & { error?: string };
  const usersData = await usersRes.json() as HeadscaleUser[] & { error?: string };
  if (!nodesRes.ok || (nodesData as { error?: string }).error) {
    container.innerHTML = `<div class="empty-state" style="color:#f87171">Failed to load nodes: ${(nodesData as { error?: string }).error ?? nodesRes.statusText}</div>`;
    return;
  }
  if (!usersRes.ok || (usersData as { error?: string }).error) {
    container.innerHTML = `<div class="empty-state" style="color:#f87171">Failed to load users: ${(usersData as { error?: string }).error ?? usersRes.statusText}</div>`;
    return;
  }
  render(container, nodesData as HeadscaleNode[], usersData as HeadscaleUser[]);
}

function nodeField(n: HeadscaleNode, col: string): string {
  switch (col) {
    case 'name': return n.name;
    case 'ip': return n.ipAddresses?.[0] ?? '';
    case 'user': return n.user?.name ?? '';
    case 'os': return n.os ?? '';
    case 'lastSeen': return n.lastSeen ?? '';
    case 'expiry': return n.expiry ?? '';
    case 'tags': return (n.forcedTags ?? []).concat(n.validTags ?? []).join(', ');
    default: return '';
  }
}

function render(container: HTMLElement, nodes: HeadscaleNode[], users: HeadscaleUser[]): void {
  const userOptions = users.map(u => `<option value="${esc(u.name)}">${esc(u.name)}</option>`).join('');
  const state = makeTableState(nodes, 'name', nodeField);

  const doRender = () => {
    const wrap = container.querySelector<HTMLElement>('#hs-nodes-table-wrap');
    if (!wrap) return;
    wrap.innerHTML = buildTable(state.view(), users, state);
    attachActions(wrap, users);
    wireSortHeaders(wrap, state, doRender);
  };

  container.innerHTML = `
    <div class="hs-section-header">
      <span class="hs-section-title">Nodes (${nodes.length})</span>
      <div class="hs-form-row">
        ${searchInput('Search nodes…')}
        <label style="margin-left:4px">User:</label>
        <select id="hs-nodes-filter">
          <option value="">All</option>
          ${userOptions}
        </select>
      </div>
    </div>
    <div id="hs-nodes-table-wrap">
      ${buildTable(state.view(), users, state)}
    </div>
  `;

  wireSearch(container, state, doRender);

  // Event delegation for CLI copy buttons — guard prevents duplicate listeners on reload
  if (!container.dataset.cliListenerAttached) {
    container.dataset.cliListenerAttached = '1';
    container.addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.hs-copy-cli-btn');
      if (!btn) return;
      const cmd = btn.dataset.cmd ?? '';
      navigator.clipboard.writeText(cmd).catch(() => {});
      showToast('Command copied', 'success');
    });
  }

  document.getElementById('hs-nodes-filter')?.addEventListener('change', async (e) => {
    const user = (e.target as HTMLSelectElement).value;
    const wrap = document.getElementById('hs-nodes-table-wrap');
    if (!wrap) return;
    wrap.innerHTML = '<div class="empty-state">Loading…</div>';
    try {
      const res = await fetch(`/api/headscale/nodes${user ? `?user=${encodeURIComponent(user)}` : ''}`);
      const filtered = await res.json() as HeadscaleNode[];
      state.all = filtered;
      state.query = '';
      const searchEl = container.querySelector<HTMLInputElement>('.hs-search-input');
      if (searchEl) searchEl.value = '';
      wrap.innerHTML = buildTable(state.view(), users, state);
      attachActions(wrap, users);
      wireSortHeaders(wrap, state, doRender);
    } catch (err) {
      wrap.innerHTML = `<div class="empty-state" style="color:#f87171">${err}</div>`;
    }
  });

  const initialWrap = container.querySelector<HTMLElement>('#hs-nodes-table-wrap')!;
  wireSortHeaders(initialWrap, state, doRender);
  attachActions(container, users);
}

function buildTable(nodes: HeadscaleNode[], users: HeadscaleUser[], state: TableState<HeadscaleNode>): string {
  if (nodes.length === 0) return '<div class="empty-state">No nodes found</div>';

  const rows = nodes.map(n => {
    const ip = n.ipAddresses?.[0] ?? '—';
    const expiry = n.expiry && !n.expiry.startsWith('0001') ? fmtDate(n.expiry) : 'Never';
    const lastSeen = n.lastSeen ? fmtDate(n.lastSeen) : '—';
    const tags = (n.forcedTags ?? []).concat(n.validTags ?? []).join(', ') || '—';
    const userOptions = users.map(u =>
      `<option value="${esc(u.name)}" ${u.name === n.user?.name ? 'selected' : ''}>${esc(u.name)}</option>`
    ).join('');

    return `<tr data-node-id="${n.id}">
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="hs-badge ${n.online ? 'online' : 'offline'}">${n.online ? 'online' : 'offline'}</span>
          <span class="hs-node-name" style="font-family:var(--font-mono);font-size:12px">${esc(n.name)}</span>
        </div>
      </td>
      <td style="font-family:var(--font-mono);font-size:11px">${esc(ip)}</td>
      <td>${esc(n.user?.name ?? '—')}</td>
      <td style="font-size:11px;color:var(--text-muted)">${esc(n.os ?? '—')}</td>
      <td style="font-size:11px;color:var(--text-muted)">${lastSeen}</td>
      <td style="font-size:11px;color:var(--text-muted)">${expiry}</td>
      <td style="font-size:11px;color:var(--text-muted);max-width:140px;overflow:hidden;text-overflow:ellipsis">${esc(tags)}</td>
      <td>
        <div class="actions">
          <button class="hs-btn hs-rename-btn" data-id="${n.id}" data-name="${esc(n.name)}">Rename</button>
          <select class="hs-move-select" data-id="${n.id}" style="background:rgba(0,0,0,.25);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:11px;padding:3px 6px;">
            <option value="">Move to…</option>
            ${userOptions}
          </select>
          <button class="hs-btn hs-tag-btn" data-id="${n.id}" data-tags="${esc((n.forcedTags ?? []).join(','))}">Tag</button>
          <button class="hs-btn danger hs-expire-btn" data-id="${n.id}">Expire</button>
          <button class="hs-btn cli hs-copy-cli-btn" data-cmd="${esc(`headscale nodes expire --identifier ${n.id}`)}" title="Copy CLI command">$</button>
          <button class="hs-btn danger hs-delete-btn" data-id="${n.id}" data-name="${esc(n.name)}">Delete</button>
          <button class="hs-btn cli hs-copy-cli-btn" data-cmd="${esc(`headscale nodes delete --identifier ${n.id}`)}" title="Copy CLI command">$</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  const s = state as TableState<unknown>;
  return `<table class="hs-table">
    <thead><tr>
      ${sortTh('Name', 'name', s)}
      ${sortTh('IP', 'ip', s)}
      ${sortTh('User', 'user', s)}
      ${sortTh('OS', 'os', s)}
      ${sortTh('Last seen', 'lastSeen', s)}
      ${sortTh('Expiry', 'expiry', s)}
      ${sortTh('Tags', 'tags', s)}
      <th>Actions</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function attachActions(container: HTMLElement, users: HeadscaleUser[]): void {
  // Rename
  container.querySelectorAll<HTMLElement>('.hs-rename-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id!;
      const current = btn.dataset.name ?? '';
      const newName = await showInput({ title: 'Rename Node', placeholder: 'New name', defaultValue: current });
      if (!newName || newName === current) return;
      try {
        await apiFetch(`/api/headscale/nodes/${id}/rename/${encodeURIComponent(newName)}`, 'POST');
        showToast(`Node renamed to ${newName}`, 'success');
        reload(container, users);
      } catch (err) { showToast(`Failed: ${err}`, 'error'); }
    });
  });

  // Move to user
  container.querySelectorAll<HTMLSelectElement>('.hs-move-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const user = sel.value;
      if (!user) return;
      const id = sel.dataset.id!;
      try {
        await apiFetch(`/api/headscale/nodes/${id}/user`, 'POST', { user });
        showToast(`Node moved to ${user}`, 'success');
        reload(container, users);
      } catch (err) {
        sel.value = '';
        showToast(`Failed: ${err}`, 'error');
      }
    });
  });

  // Tag
  container.querySelectorAll<HTMLElement>('.hs-tag-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id!;
      const current = btn.dataset.tags ?? '';
      const input = await showInput({ title: 'Set Tags', message: 'Comma-separated, e.g. tag:server,tag:prod', placeholder: 'tag:server', defaultValue: current });
      if (input === null) return;
      const tags = input.split(',').map(t => t.trim()).filter(Boolean);
      try {
        await apiFetch(`/api/headscale/nodes/${id}/tags`, 'POST', { tags });
        showToast('Tags updated', 'success');
        reload(container, users);
      } catch (err) { showToast(`Failed: ${err}`, 'error'); }
    });
  });

  // Expire
  container.querySelectorAll<HTMLElement>('.hs-expire-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await showConfirm({ title: 'Expire Node', message: 'This node will need to re-authenticate.', confirmLabel: 'Expire', danger: true })) return;
      const id = btn.dataset.id!;
      try {
        await apiFetch(`/api/headscale/nodes/${id}/expire`, 'POST');
        showToast('Node expired', 'success');
        reload(container, users);
      } catch (err) { showToast(`Failed: ${err}`, 'error'); }
    });
  });

  // Delete
  container.querySelectorAll<HTMLElement>('.hs-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.name ?? btn.dataset.id!;
      if (!await showConfirm({ title: 'Delete Node', message: `Delete "${name}"? This cannot be undone.`, confirmLabel: 'Delete', danger: true })) return;
      const id = btn.dataset.id!;
      try {
        await apiFetch(`/api/headscale/nodes/${id}`, 'DELETE');
        showToast(`Node "${name}" deleted`, 'success');
        reload(container, users);
      } catch (err) { showToast(`Failed: ${err}`, 'error'); }
    });
  });
}

async function reload(container: HTMLElement, users: HeadscaleUser[]): Promise<void> {
  try {
    const res = await fetch('/api/headscale/nodes');
    const nodes = await res.json() as HeadscaleNode[];
    render(container, nodes, users);
  } catch (err) {
    showToast(`Reload failed: ${err}`, 'error');
  }
}

async function apiFetch(url: string, method: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json() as { ok?: boolean; error?: string; message?: string };
  if (!res.ok || data.ok === false) throw new Error(data.error ?? data.message ?? res.statusText);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
