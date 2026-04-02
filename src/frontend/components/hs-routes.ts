import type { HeadscaleNode } from '../../backend/types.js';
import { showToast } from './toast.js';
import { makeTableState, sortTh, searchInput, wireSearch, wireSortHeaders, type TableState } from './table-utils.js';

// Routes are embedded in node objects in newer headscale versions.
// We aggregate them from the node list for display (read-only).
interface NodeRoute {
  prefix: string;
  nodeName: string;
  nodeId: string;
  approved: boolean;
}

export async function renderHsRoutes(container: HTMLElement): Promise<void> {
  const res = await fetch('/api/headscale/nodes');
  const data = await res.json() as HeadscaleNode[] & { error?: string };
  if (!res.ok || (data as { error?: string }).error) {
    container.innerHTML = `<div class="empty-state" style="color:#f87171">Failed to load routes: ${(data as { error?: string }).error ?? res.statusText}</div>`;
    return;
  }
  const nodes = data as HeadscaleNode[];

  // Aggregate routes from all nodes
  const routes: NodeRoute[] = [];
  for (const node of nodes) {
    const available: string[] = (node as unknown as { availableRoutes?: string[] }).availableRoutes ?? [];
    const approved: string[] = (node as unknown as { approvedRoutes?: string[] }).approvedRoutes ?? [];
    const approvedSet = new Set(approved);
    for (const prefix of available) {
      routes.push({
        prefix,
        nodeName: (node as unknown as { givenName?: string }).givenName || node.name,
        nodeId: node.id,
        approved: approvedSet.has(prefix),
      });
    }
  }

  render(container, routes);
}

function routeField(r: NodeRoute, col: string): string {
  switch (col) {
    case 'prefix': return r.prefix;
    case 'nodeName': return r.nodeName;
    case 'approved': return r.approved ? 'approved' : 'pending';
    default: return '';
  }
}

function render(container: HTMLElement, routes: NodeRoute[]): void {
  const state = makeTableState(routes, 'prefix', routeField);

  const doRender = () => {
    const wrap = container.querySelector<HTMLElement>('.hs-routes-table-wrap');
    if (!wrap) return;
    wrap.innerHTML = buildTable(state.view(), state);
    wireSortHeaders(wrap, state, doRender);
  };

  container.innerHTML = `
    <div class="hs-section-header">
      <span class="hs-section-title">Advertised Routes (${routes.length})</span>
      <div class="hs-form-row">
        ${searchInput('Search routes…')}
      </div>
    </div>
    <div class="empty-state" style="color:var(--text-muted);font-size:11px;margin-bottom:12px;text-align:left;padding:0">
      Route approval requires the CLI: <code style="font-family:var(--font-mono);background:rgba(255,255,255,.06);padding:1px 5px;border-radius:3px">headscale nodes approve-routes --identifier &lt;id&gt; --routes &lt;prefix&gt;</code>
    </div>
    <div class="hs-routes-table-wrap">
      ${buildTable(state.view(), state)}
    </div>
  `;

  // Event delegation for copy-CLI buttons — guard prevents duplicate listeners
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

  wireSearch(container, state, doRender);
  const initialWrap = container.querySelector<HTMLElement>('.hs-routes-table-wrap')!;
  wireSortHeaders(initialWrap, state, doRender);
}

function buildTable(routes: NodeRoute[], state: TableState<NodeRoute>): string {
  if (routes.length === 0) return '<div class="empty-state">No routes found</div>';

  const rows = routes.map(r => {
    const approveCmd = `headscale nodes approve-routes --identifier ${r.nodeId} --routes ${r.prefix}`;
    const actionCell = r.approved
      ? ''
      : `<button class="hs-btn cli hs-copy-cli-btn" data-cmd="${esc(approveCmd)}" title="${esc(approveCmd)}">$ approve</button>`;
    return `<tr>
    <td style="font-family:var(--font-mono);font-size:12px">${esc(r.prefix)}</td>
    <td style="font-size:12px">${esc(r.nodeName)}</td>
    <td>
      <div style="display:flex;align-items:center;gap:6px">
        ${r.approved ? '<span class="hs-badge online">approved</span>' : '<span class="hs-badge offline">pending</span>'}
        ${actionCell}
      </div>
    </td>
  </tr>`;
  }).join('');

  const s = state as TableState<unknown>;
  return `<table class="hs-table">
    <thead><tr>
      ${sortTh('Prefix', 'prefix', s)}
      ${sortTh('Node', 'nodeName', s)}
      ${sortTh('Status', 'approved', s)}
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
