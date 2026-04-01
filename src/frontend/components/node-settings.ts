import { showToast } from './toast.js';

interface Prefs {
  ControlURL: string;
  RouteAll: boolean;
  ExitNodeAllowLANAccess: boolean;
  CorpDNS: boolean;
  RunSSH: boolean;
  RunWebClient: boolean;
  ShieldsUp: boolean;
  Hostname: string;
  AdvertiseRoutes: string[] | null;
  AdvertiseTags: string[] | null;
  NoSNAT: boolean;
  NoStatefulFiltering: boolean;
  AutoUpdate: { Check: boolean; Apply: boolean | null };
  AppConnector: { Advertise: boolean };
  PostureChecking: boolean;
  AllowSingleHosts: boolean;
  WantRunning: boolean;
}

let currentPrefs: Prefs | null = null;
let isExpanded = false;
let isSaving = false;

export function initNodeSettings(): void {
  const toggle = document.getElementById('node-settings-toggle');
  toggle?.addEventListener('click', () => {
    isExpanded = !isExpanded;
    const body = document.getElementById('node-settings-body');
    const arrow = document.getElementById('node-settings-arrow');
    if (body) body.classList.toggle('expanded', isExpanded);
    if (arrow) arrow.textContent = isExpanded ? '▾' : '▸';
    if (isExpanded && !currentPrefs) loadPrefs();
  });

  document.addEventListener('tailscale-connected', () => {
    if (isExpanded) loadPrefs();
  });
}

export async function loadPrefs(): Promise<void> {
  const panel = document.getElementById('node-settings-body');
  if (!panel) return;
  try {
    const res = await fetch('/api/node-prefs');
    if (!res.ok) throw new Error(await res.text());
    currentPrefs = await res.json() as Prefs;
    renderPrefs(currentPrefs);
  } catch (err) {
    panel.innerHTML = `<div class="settings-error">Failed to load: ${err}</div>`;
  }
}

function renderPrefs(p: Prefs): void {
  const panel = document.getElementById('node-settings-body');
  if (!panel) return;

  panel.innerHTML = `
    <div class="settings-form">

      <div class="settings-group">
        <div class="settings-group-title">Identity</div>

        <div class="settings-row">
          <label class="settings-label" for="ns-hostname">Hostname override</label>
          <input class="settings-input" id="ns-hostname" type="text"
            placeholder="(use OS hostname)"
            value="${p.Hostname ?? ''}" />
        </div>

        <div class="settings-row">
          <label class="settings-label">Control server</label>
          <span class="settings-value-readonly">${p.ControlURL}</span>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">Network</div>

        ${toggle('ns-accept-routes', 'Accept routes', 'Accept subnet routes advertised by other nodes', p.RouteAll)}
        ${toggle('ns-accept-dns', 'Accept DNS', 'Use DNS settings from the admin panel', p.CorpDNS)}
        ${toggle('ns-shields-up', 'Shields up', 'Block all incoming connections', p.ShieldsUp)}
        ${toggle('ns-lan-access', 'LAN access via exit node', 'Allow direct LAN access when using an exit node', p.ExitNodeAllowLANAccess)}
        ${toggle('ns-no-snat', 'Disable SNAT', 'Disable source NAT for subnet routes', p.NoSNAT)}
        ${toggle('ns-no-stateful', 'No stateful filtering', 'Disable stateful packet filtering', p.NoStatefulFiltering)}
        ${toggle('ns-allow-single', 'Allow single hosts', 'Allow single-host routes', p.AllowSingleHosts)}
      </div>

      <div class="settings-group">
        <div class="settings-group-title">Services</div>

        ${toggle('ns-ssh', 'Tailscale SSH', 'Run SSH server accessible via Tailscale', p.RunSSH)}
        ${toggle('ns-webclient', 'Web client', 'Expose web management UI at port 5252', p.RunWebClient)}
        ${toggle('ns-app-connector', 'App connector', 'Act as app connector for this tailnet', p.AppConnector?.Advertise ?? false)}
        ${toggle('ns-advertise-exit', 'Advertise as exit node', 'Offer this node as an exit node for the tailnet', false, 'exit-node-advertise')}
      </div>

      <div class="settings-group">
        <div class="settings-group-title">Advertised Routes</div>
        <div class="settings-row col">
          <label class="settings-label" for="ns-routes">Subnet routes</label>
          <input class="settings-input" id="ns-routes" type="text"
            placeholder="e.g. 192.168.1.0/24,10.0.0.0/8"
            value="${(p.AdvertiseRoutes ?? []).join(', ')}" />
          <span class="settings-hint">Comma-separated CIDR ranges, or empty to stop advertising</span>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-group-title">Updates</div>

        ${toggle('ns-update-check', 'Check for updates', 'Notify about available Tailscale updates', p.AutoUpdate?.Check ?? false)}
        ${toggle('ns-posture', 'Report posture', 'Allow management plane to gather device posture info', p.PostureChecking)}
      </div>

      <button class="btn btn-primary settings-save ${isSaving ? 'saving' : ''}"
              id="node-settings-save"
              ${isSaving ? 'disabled' : ''}>
        ${isSaving ? 'Applying…' : 'Apply changes'}
      </button>
    </div>
  `;

  document.getElementById('node-settings-save')?.addEventListener('click', savePrefs);
}

function toggle(id: string, label: string, hint: string, checked: boolean, _key?: string): string {
  return `
    <div class="settings-row toggle-row">
      <div class="settings-toggle-info">
        <span class="settings-label">${label}</span>
        <span class="settings-hint">${hint}</span>
      </div>
      <label class="toggle-switch">
        <input type="checkbox" id="${id}" ${checked ? 'checked' : ''} />
        <span class="toggle-track"><span class="toggle-thumb"></span></span>
      </label>
    </div>`;
}

function getChecked(id: string): boolean {
  return (document.getElementById(id) as HTMLInputElement | null)?.checked ?? false;
}

function getVal(id: string): string {
  return ((document.getElementById(id) as HTMLInputElement | null)?.value ?? '').trim();
}

async function savePrefs(): Promise<void> {
  if (isSaving) return;
  isSaving = true;
  const btn = document.getElementById('node-settings-save') as HTMLButtonElement | null;
  if (btn) { btn.disabled = true; btn.textContent = 'Applying…'; }

  const flags: string[] = [];

  // Identity
  const hostname = getVal('ns-hostname');
  flags.push(`--hostname=${hostname}`);

  // Network toggles
  flags.push(`--accept-routes=${getChecked('ns-accept-routes')}`);
  flags.push(`--accept-dns=${getChecked('ns-accept-dns')}`);
  flags.push(`--shields-up=${getChecked('ns-shields-up')}`);
  flags.push(`--exit-node-allow-lan-access=${getChecked('ns-lan-access')}`);

  // Services
  flags.push(`--ssh=${getChecked('ns-ssh')}`);
  flags.push(`--webclient=${getChecked('ns-webclient')}`);
  flags.push(`--advertise-connector=${getChecked('ns-app-connector')}`);
  flags.push(`--advertise-exit-node=${getChecked('ns-advertise-exit')}`);

  // Routes
  const routesRaw = getVal('ns-routes');
  const routes = routesRaw.split(',').map(s => s.trim()).filter(Boolean).join(',');
  flags.push(`--advertise-routes=${routes}`);

  // Updates
  flags.push(`--update-check=${getChecked('ns-update-check')}`);
  flags.push(`--report-posture=${getChecked('ns-posture')}`);

  try {
    const res = await fetch('/api/node-prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flags }),
    });
    const data = await res.json() as { ok: boolean; error?: string };
    if (data.ok) {
      showToast('Node settings applied', 'success');
      await loadPrefs(); // refresh to show actual values
    } else {
      showToast(`Failed: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Request failed: ${err}`, 'error');
  } finally {
    isSaving = false;
    const btn2 = document.getElementById('node-settings-save') as HTMLButtonElement | null;
    if (btn2) { btn2.disabled = false; btn2.textContent = 'Apply changes'; }
  }
}
