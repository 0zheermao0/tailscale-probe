import type { HeadscaleApiKey } from '../../backend/types.js';
import { showToast } from './toast.js';
import { showConfirm } from './dialog.js';
import { makeTableState, sortTh, searchInput, wireSearch, wireSortHeaders, type TableState } from './table-utils.js';

export async function renderHsApiKeys(container: HTMLElement): Promise<void> {
  const res = await fetch('/api/headscale/apikeys');
  const keys = await res.json() as HeadscaleApiKey[] & { error?: string };
  if (!Array.isArray(keys)) {
    container.innerHTML = `<div class="empty-state" style="color:#f87171">Failed to load API keys</div>`;
    return;
  }
  render(container, keys);
}

function apiKeyField(k: HeadscaleApiKey, col: string): string {
  switch (col) {
    case 'prefix': return k.prefix;
    case 'createdAt': return k.createdAt;
    case 'lastSeen': return k.lastSeen ?? '';
    case 'expiration': return k.expiration ?? '';
    default: return '';
  }
}

function render(container: HTMLElement, keys: HeadscaleApiKey[]): void {
  const state = makeTableState(keys, 'createdAt', apiKeyField);

  const doRender = () => {
    const wrap = container.querySelector<HTMLElement>('.hs-ak-table-wrap');
    if (!wrap) return;
    wrap.innerHTML = buildTable(state.view(), state);
    attachActions(container);
    wireSortHeaders(wrap, state, doRender);
  };

  container.innerHTML = `
    <div class="hs-section-header">
      <span class="hs-section-title">API Keys (${keys.length})</span>
      <div class="hs-form-row">
        ${searchInput('Search keys…')}
        <label style="margin-left:4px">Expiry:</label>
        <input type="datetime-local" id="hs-ak-expiry"
          style="background:rgba(0,0,0,.25);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:12px;padding:4px 8px" />
        <button class="hs-btn primary" id="hs-create-ak-btn">+ Create Key</button>
        <button class="hs-btn cli" id="hs-copy-ak-cli-btn" title="Copy CLI command">$ copy cmd</button>
      </div>
    </div>
    <div id="hs-ak-reveal" style="display:none" class="hs-key-reveal" style="margin-bottom:12px">
      <span style="font-size:11px;color:var(--text-muted);white-space:nowrap">New key (copy now):</span>
      <span class="hs-key-reveal-value" id="hs-ak-reveal-val"></span>
      <button class="hs-btn" id="hs-ak-copy-btn">Copy</button>
    </div>
    <div class="hs-ak-table-wrap">
      ${buildTable(state.view(), state)}
    </div>
  `;

  document.getElementById('hs-create-ak-btn')?.addEventListener('click', async () => {
    const expiryInput = (document.getElementById('hs-ak-expiry') as HTMLInputElement).value;
    const expiration = expiryInput ? new Date(expiryInput).toISOString() : undefined;

    try {
      const res = await fetch('/api/headscale/apikeys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(expiration ? { expiration } : {}),
      });
      const data = await res.json() as { apiKey?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? res.statusText);

      const reveal = document.getElementById('hs-ak-reveal');
      const revealVal = document.getElementById('hs-ak-reveal-val');
      if (reveal && revealVal && data.apiKey) {
        revealVal.textContent = data.apiKey;
        reveal.style.display = 'flex';
      }
      document.getElementById('hs-ak-copy-btn')?.addEventListener('click', () => {
        navigator.clipboard.writeText(data.apiKey ?? '').catch(() => {});
        showToast('API key copied', 'success');
      }, { once: true });

      showToast('API key created', 'success');
      const fresh = await fetch('/api/headscale/apikeys');
      const freshKeys = await fresh.json() as HeadscaleApiKey[];
      state.all = freshKeys;
      const wrap = container.querySelector<HTMLElement>('.hs-ak-table-wrap');
      if (wrap) { wrap.innerHTML = buildTable(state.view(), state); attachActions(container); wireSortHeaders(wrap, state, doRender); }
    } catch (err) { showToast(`Failed: ${err}`, 'error'); }
  });

  if (!container.dataset.cliListenerAttached) {
    container.dataset.cliListenerAttached = '1';
    container.addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('#hs-copy-ak-cli-btn');
      if (!btn) return;
      const expiryInput = (document.getElementById('hs-ak-expiry') as HTMLInputElement).value;
      let cmd = 'headscale apikeys create';
      if (expiryInput) {
        const diffMs = new Date(expiryInput).getTime() - Date.now();
        const diffH = Math.round(diffMs / 3600000);
        if (diffH > 0) cmd += ` --expiration ${diffH}h`;
      }
      navigator.clipboard.writeText(cmd).catch(() => {});
      showToast('Command copied', 'success');
    });
  }

  wireSearch(container, state, doRender);
  const initialWrap = container.querySelector<HTMLElement>('.hs-ak-table-wrap')!;
  wireSortHeaders(initialWrap, state, doRender);
  attachActions(container);
}

function buildTable(keys: HeadscaleApiKey[], state: TableState<HeadscaleApiKey>): string {
  if (keys.length === 0) return '<div class="empty-state" style="margin-top:8px">No API keys</div>';

  const rows = keys.map(k => {
    const expired = k.expiration && !k.expiration.startsWith('0001') && new Date(k.expiration) < new Date();
    const expiry = k.expiration && !k.expiration.startsWith('0001') ? fmtDate(k.expiration) : 'Never';
    const lastSeen = k.lastSeen && !k.lastSeen.startsWith('0001') ? fmtDate(k.lastSeen) : '—';

    return `<tr>
      <td style="font-family:var(--font-mono);font-size:12px">${esc(k.prefix)}…</td>
      <td style="font-size:11px;color:var(--text-muted)">${fmtDate(k.createdAt)}</td>
      <td style="font-size:11px;color:var(--text-muted)">${lastSeen}</td>
      <td style="font-size:11px;color:${expired ? '#f87171' : 'var(--text-muted)'}">${expiry}</td>
      <td>
        <div class="actions">
          <button class="hs-btn danger hs-expire-ak-btn" data-prefix="${esc(k.prefix)}" ${expired ? 'disabled' : ''}>Expire</button>
          <button class="hs-btn danger hs-delete-ak-btn" data-prefix="${esc(k.prefix)}">Delete</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  const s = state as TableState<unknown>;
  return `<table class="hs-table">
    <thead><tr>
      ${sortTh('Prefix', 'prefix', s)}
      ${sortTh('Created', 'createdAt', s)}
      ${sortTh('Last used', 'lastSeen', s)}
      ${sortTh('Expiry', 'expiration', s)}
      <th>Actions</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function attachActions(container: HTMLElement): void {
  container.querySelectorAll<HTMLElement>('.hs-expire-ak-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await showConfirm({ title: 'Expire API Key', message: 'This key will stop working immediately.', confirmLabel: 'Expire', danger: true })) return;
      const prefix = btn.dataset.prefix!;
      try {
        const res = await fetch(`/api/headscale/apikeys/${encodeURIComponent(prefix)}/expire`, { method: 'POST' });
        if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? res.statusText); }
        showToast('API key expired', 'success');
        await renderHsApiKeys(container);
      } catch (err) { showToast(`Failed: ${err}`, 'error'); }
    });
  });

  container.querySelectorAll<HTMLElement>('.hs-delete-ak-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const prefix = btn.dataset.prefix!;
      if (!await showConfirm({ title: 'Delete API Key', message: `Delete key ${prefix}…? This cannot be undone.`, confirmLabel: 'Delete', danger: true })) return;
      try {
        const res = await fetch(`/api/headscale/apikeys/${encodeURIComponent(prefix)}`, { method: 'DELETE' });
        if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? res.statusText); }
        showToast('API key deleted', 'success');
        await renderHsApiKeys(container);
      } catch (err) { showToast(`Failed: ${err}`, 'error'); }
    });
  });
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
