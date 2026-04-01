import type { HeadscaleRoute } from '../../backend/types.js';
import { showToast } from './toast.js';

export async function renderHsRoutes(container: HTMLElement): Promise<void> {
  const res = await fetch('/api/headscale/routes');
  const routes = await res.json() as HeadscaleRoute[];
  render(container, routes);
}

function render(container: HTMLElement, routes: HeadscaleRoute[]): void {
  container.innerHTML = `
    <div class="hs-section-header">
      <span class="hs-section-title">Routes (${routes.length})</span>
    </div>
    ${buildTable(routes)}
  `;
  attachActions(container, routes);
}

function buildTable(routes: HeadscaleRoute[]): string {
  if (routes.length === 0) return '<div class="empty-state">No routes advertised</div>';

  const rows = routes.map(r => {
    const nodeName = r.node?.name ?? r.node?.id ?? '—';
    return `<tr data-route-id="${r.id}">
      <td style="font-family:var(--font-mono);font-size:12px">${esc(r.prefix)}</td>
      <td style="font-size:12px">${esc(nodeName)}</td>
      <td>${r.advertised ? '<span class="hs-badge online">yes</span>' : '<span class="hs-badge offline">no</span>'}</td>
      <td>
        <label class="toggle-switch" title="${r.enabled ? 'Disable route' : 'Enable route'}">
          <input type="checkbox" class="hs-route-toggle" data-id="${r.id}" data-enabled="${r.enabled}" ${r.enabled ? 'checked' : ''} />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </td>
      <td>${r.isPrimary ? '<span class="hs-badge primary-route">primary</span>' : ''}</td>
      <td>
        <button class="hs-btn danger hs-delete-route-btn" data-id="${r.id}" data-prefix="${esc(r.prefix)}">Delete</button>
      </td>
    </tr>`;
  }).join('');

  return `<table class="hs-table">
    <thead><tr>
      <th>Prefix</th><th>Node</th><th>Advertised</th><th>Enabled</th><th>Primary</th><th>Actions</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function attachActions(container: HTMLElement, routes: HeadscaleRoute[]): void {
  container.querySelectorAll<HTMLInputElement>('.hs-route-toggle').forEach(toggle => {
    toggle.addEventListener('change', async () => {
      const id = toggle.dataset.id!;
      const enable = toggle.checked;
      toggle.disabled = true;
      try {
        const res = await fetch(`/api/headscale/routes/${id}/${enable ? 'enable' : 'disable'}`, { method: 'POST' });
        if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? res.statusText); }
        showToast(`Route ${enable ? 'enabled' : 'disabled'}`, 'success');
        // Update data attribute
        toggle.dataset.enabled = String(enable);
      } catch (err) {
        toggle.checked = !enable; // revert
        showToast(`Failed: ${err}`, 'error');
      } finally {
        toggle.disabled = false;
      }
    });
  });

  container.querySelectorAll<HTMLElement>('.hs-delete-route-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const prefix = btn.dataset.prefix ?? btn.dataset.id!;
      if (!confirm(`Delete route ${prefix}?`)) return;
      const id = btn.dataset.id!;
      try {
        const res = await fetch(`/api/headscale/routes/${id}`, { method: 'DELETE' });
        if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? res.statusText); }
        showToast('Route deleted', 'success');
        const fresh = await fetch('/api/headscale/routes');
        const freshRoutes = await fresh.json() as HeadscaleRoute[];
        render(container, freshRoutes);
      } catch (err) { showToast(`Failed: ${err}`, 'error'); }
    });
  });
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
