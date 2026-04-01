import { renderHsNodes } from './hs-nodes.js';
import { renderHsUsers } from './hs-users.js';
import { renderHsPreauth } from './hs-preauth.js';
import { renderHsRoutes } from './hs-routes.js';
import { renderHsAcl } from './hs-acl.js';
import { renderHsDns } from './hs-dns.js';
import { renderHsApiKeys } from './hs-apikeys.js';

type TabId = 'nodes' | 'users' | 'preauth' | 'routes' | 'acl' | 'dns' | 'apikeys';

const TAB_RENDERERS: Record<TabId, (el: HTMLElement) => Promise<void>> = {
  nodes: renderHsNodes,
  users: renderHsUsers,
  preauth: renderHsPreauth,
  routes: renderHsRoutes,
  acl: renderHsAcl,
  dns: renderHsDns,
  apikeys: renderHsApiKeys,
};

let activeTab: TabId = 'nodes';

export async function initHeadscalePanel(): Promise<void> {
  // Check if headscale is available
  try {
    const res = await fetch('/api/headscale/status');
    const data = await res.json() as { available: boolean };
    if (!data.available) return;
  } catch {
    return;
  }

  // Show tab buttons
  const hsBtn = document.getElementById('hs-tab-btn');
  const tsBtn = document.getElementById('tailscale-tab-btn');
  if (hsBtn) hsBtn.style.display = '';
  if (tsBtn) tsBtn.style.display = '';

  // Tab button click handlers
  hsBtn?.addEventListener('click', () => showView('headscale'));
  tsBtn?.addEventListener('click', () => showView('tailscale'));

  // Headscale inner tab switching
  document.querySelectorAll<HTMLElement>('.hs-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab as TabId;
      if (!tab || tab === activeTab) return;
      switchTab(tab);
    });
  });
}

function showView(view: 'tailscale' | 'headscale'): void {
  const mainContent = document.querySelector<HTMLElement>('.main-content');
  const hsPanel = document.getElementById('headscale-panel');
  const hsBtn = document.getElementById('hs-tab-btn');
  const tsBtn = document.getElementById('tailscale-tab-btn');

  if (!mainContent || !hsPanel) return;

  if (view === 'headscale') {
    mainContent.style.display = 'none';
    hsPanel.style.display = 'flex';
    hsBtn?.classList.add('active');
    tsBtn?.classList.remove('active');
    // Load initial tab
    const content = document.getElementById('hs-tab-content');
    if (content && content.childElementCount === 0) {
      switchTab(activeTab);
    }
  } else {
    mainContent.style.display = '';
    hsPanel.style.display = 'none';
    hsBtn?.classList.remove('active');
    tsBtn?.classList.add('active');
  }
}

function switchTab(tab: TabId): void {
  activeTab = tab;

  // Update tab button states
  document.querySelectorAll<HTMLElement>('.hs-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  const content = document.getElementById('hs-tab-content');
  if (!content) return;

  content.innerHTML = '<div class="empty-state">Loading…</div>';
  TAB_RENDERERS[tab](content).catch(err => {
    content.innerHTML = `<div class="empty-state" style="color:#f87171">Failed to load: ${err}</div>`;
  });
}
