import type { HeadscaleUser } from '../../backend/types.js';
import { showToast } from './toast.js';
import { showConfirm, showInput } from './dialog.js';
import { makeTableState, sortTh, searchInput, wireSearch, wireSortHeaders, type TableState } from './table-utils.js';

export async function renderHsUsers(container: HTMLElement): Promise<void> {
  const res = await fetch('/api/headscale/users');
  const data = await res.json() as HeadscaleUser[] & { error?: string };
  if (!res.ok || (data as { error?: string }).error) {
    container.innerHTML = `<div class="empty-state" style="color:#f87171">Failed to load users: ${(data as { error?: string }).error ?? res.statusText}</div>`;
    return;
  }
  render(container, data as HeadscaleUser[]);
}

function userField(u: HeadscaleUser, col: string): string {
  switch (col) {
    case 'name': return u.name;
    case 'createdAt': return u.createdAt;
    default: return '';
  }
}

function render(container: HTMLElement, users: HeadscaleUser[]): void {
  const state = makeTableState(users, 'name', userField);

  const doRender = () => {
    const wrap = container.querySelector<HTMLElement>('.hs-users-table-wrap');
    if (!wrap) return;
    wrap.innerHTML = buildTable(state.view(), state);
    attachActions(container);
    wireSortHeaders(wrap, state, doRender);
  };

  container.innerHTML = `
    <div class="hs-section-header">
      <span class="hs-section-title">Users (${users.length})</span>
      <div class="hs-form-row">
        ${searchInput('Search users…')}
        <input id="hs-new-user" type="text" placeholder="New user name" style="width:140px" />
        <button class="hs-btn primary" id="hs-create-user-btn">+ Create</button>
        <button class="hs-btn cli" id="hs-copy-user-cli-btn" title="Copy CLI command">$ copy cmd</button>
      </div>
    </div>
    <div class="hs-users-table-wrap">
      ${buildTable(state.view(), state)}
    </div>
  `;

  document.getElementById('hs-create-user-btn')?.addEventListener('click', async () => {
    const input = document.getElementById('hs-new-user') as HTMLInputElement | null;
    const name = input?.value.trim();
    if (!name) return;
    try {
      const res = await fetch('/api/headscale/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json() as { id?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? res.statusText);
      showToast(`User "${name}" created`, 'success');
      if (input) input.value = '';
      reload(container);
    } catch (err) { showToast(`Failed: ${err}`, 'error'); }
  });

  if (!container.dataset.cliListenerAttached) {
    container.dataset.cliListenerAttached = '1';
    container.addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('#hs-copy-user-cli-btn');
      if (!btn) return;
      const input = document.getElementById('hs-new-user') as HTMLInputElement | null;
      const name = input?.value.trim() ?? '';
      const cmd = name ? `headscale users create ${name}` : 'headscale users create <name>';
      navigator.clipboard.writeText(cmd).catch(() => {});
      showToast('Command copied', 'success');
    });
  }

  wireSearch(container, state, doRender);
  const initialWrap = container.querySelector<HTMLElement>('.hs-users-table-wrap')!;
  wireSortHeaders(initialWrap, state, doRender);
  attachActions(container);
}

function buildTable(users: HeadscaleUser[], state: TableState<HeadscaleUser>): string {
  if (users.length === 0) return '<div class="empty-state">No users found</div>';

  const rows = users.map(u => `
    <tr data-user-name="${esc(u.name)}">
      <td style="font-family:var(--font-mono);font-size:12px">${esc(u.name)}</td>
      <td style="font-size:11px;color:var(--text-muted)">${fmtDate(u.createdAt)}</td>
      <td>
        <div class="actions">
          <button class="hs-btn hs-rename-user-btn" data-name="${esc(u.name)}">Rename</button>
          <button class="hs-btn danger hs-delete-user-btn" data-name="${esc(u.name)}">Delete</button>
        </div>
      </td>
    </tr>`).join('');

  const s = state as TableState<unknown>;
  return `<table class="hs-table">
    <thead><tr>
      ${sortTh('Name', 'name', s)}
      ${sortTh('Created', 'createdAt', s)}
      <th>Actions</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function attachActions(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>('.hs-rename-user-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.name!;
      const newName = await showInput({ title: 'Rename User', placeholder: 'New name', defaultValue: name });
      if (!newName || newName === name) return;
      try {
        const res = await fetch(`/api/headscale/users/${encodeURIComponent(name)}/rename/${encodeURIComponent(newName)}`, { method: 'POST' });
        if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? res.statusText); }
        showToast(`Renamed to "${newName}"`, 'success');
        reload(container);
      } catch (err) { showToast(`Failed: ${err}`, 'error'); }
    });
  });

  container.querySelectorAll<HTMLElement>('.hs-delete-user-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.name!;
      if (!await showConfirm({ title: 'Delete User', message: `Delete "${name}"? All their nodes will be unassigned.`, confirmLabel: 'Delete', danger: true })) return;
      try {
        const res = await fetch(`/api/headscale/users/${encodeURIComponent(name)}`, { method: 'DELETE' });
        if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? res.statusText); }
        showToast(`User "${name}" deleted`, 'success');
        reload(container);
      } catch (err) { showToast(`Failed: ${err}`, 'error'); }
    });
  });
}

async function reload(container: HTMLElement): Promise<void> {
  try {
    const res = await fetch('/api/headscale/users');
    const users = await res.json() as HeadscaleUser[];
    render(container, users);
  } catch (err) { showToast(`Reload failed: ${err}`, 'error'); }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
