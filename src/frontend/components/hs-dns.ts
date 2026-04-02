import type { HeadscaleDns } from '../../backend/types.js';
import { showToast } from './toast.js';

export async function renderHsDns(container: HTMLElement): Promise<void> {
  const res = await fetch('/api/headscale/dns');
  const data = await res.json() as HeadscaleDns & { error?: string };
  if (!res.ok) {
    // Newer headscale versions removed the /api/v1/dns/settings endpoint
    container.innerHTML = `
      <div class="hs-section-header">
        <span class="hs-section-title">DNS Configuration</span>
      </div>
      <div class="empty-state" style="color:var(--text-muted)">
        DNS configuration API is not available in this Headscale version.<br>
        <span style="font-size:11px">Manage DNS settings directly in your <code style="font-family:var(--font-mono);background:rgba(255,255,255,.06);padding:1px 4px;border-radius:3px">config.yaml</code> on the Headscale server.</span>
      </div>`;
    return;
  }
  if (data.error) {
    container.innerHTML = `<div class="empty-state" style="color:#f87171">Failed to load DNS config: ${data.error}</div>`;
    return;
  }
  render(container, data);
}

function render(container: HTMLElement, dns: HeadscaleDns): void {
  const extraRows = (dns.extraRecords ?? []).map((r, i) => extraRecordRow(i, r.name, r.type, r.value)).join('');

  container.innerHTML = `
    <div class="hs-section-header">
      <span class="hs-section-title">DNS Configuration</span>
    </div>

    <div class="glass-card" style="padding:16px;display:flex;flex-direction:column;gap:14px">

      <div class="settings-row toggle-row">
        <div class="settings-toggle-info">
          <span class="settings-label">MagicDNS</span>
          <span class="settings-hint">Enable MagicDNS for automatic DNS resolution of node names</span>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="hs-dns-magic" ${dns.magicDns ? 'checked' : ''} />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>

      <div class="settings-row toggle-row">
        <div class="settings-toggle-info">
          <span class="settings-label">Override local DNS</span>
          <span class="settings-hint">Replace the client's local DNS resolver with headscale's nameservers</span>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="hs-dns-override" ${dns.overrideLocalDns ? 'checked' : ''} />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </div>

      <div class="settings-row col">
        <label class="settings-label">Base domain</label>
        <span class="settings-value-readonly" style="font-family:var(--font-mono);font-size:12px">${esc(dns.baseDomain ?? '')}</span>
      </div>

      <div class="settings-row col">
        <label class="settings-label" for="hs-dns-ns">Nameservers</label>
        <textarea id="hs-dns-ns" class="settings-input" rows="3" placeholder="One per line, e.g. 1.1.1.1"
          style="font-family:var(--font-mono);font-size:12px;resize:vertical">${esc((dns.nameservers ?? []).join('\n'))}</textarea>
        <span class="settings-hint">Global nameservers, one per line</span>
      </div>

      <div class="settings-row col">
        <label class="settings-label" for="hs-dns-domains">Search domains</label>
        <input id="hs-dns-domains" class="settings-input" type="text"
          placeholder="example.com, corp.internal"
          value="${esc((dns.domains ?? []).join(', '))}" />
        <span class="settings-hint">Comma-separated search domains</span>
      </div>

      <div class="settings-row col">
        <label class="settings-label">Extra DNS records</label>
        <div id="hs-dns-extra-records" class="hs-dns-records">
          ${extraRows}
        </div>
        <button class="hs-btn" id="hs-dns-add-record" style="align-self:flex-start;margin-top:4px">+ Add record</button>
      </div>

      <button class="btn btn-primary" id="hs-dns-save-btn">Save DNS Config</button>
    </div>
  `;

  let recordCount = (dns.extraRecords ?? []).length;

  document.getElementById('hs-dns-add-record')?.addEventListener('click', () => {
    const wrap = document.getElementById('hs-dns-extra-records');
    if (!wrap) return;
    wrap.insertAdjacentHTML('beforeend', extraRecordRow(recordCount++, '', 'A', ''));
  });

  document.getElementById('hs-dns-save-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('hs-dns-save-btn') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Saving…';

    const nsRaw = (document.getElementById('hs-dns-ns') as HTMLTextAreaElement).value;
    const nameservers = nsRaw.split('\n').map(s => s.trim()).filter(Boolean);
    const domainsRaw = (document.getElementById('hs-dns-domains') as HTMLInputElement).value;
    const domains = domainsRaw.split(',').map(s => s.trim()).filter(Boolean);
    const magicDns = (document.getElementById('hs-dns-magic') as HTMLInputElement).checked;
    const overrideLocalDns = (document.getElementById('hs-dns-override') as HTMLInputElement).checked;

    // Collect extra records
    const extraRecords: Array<{ name: string; type: string; value: string }> = [];
    document.querySelectorAll<HTMLElement>('.hs-extra-record-row').forEach(row => {
      const name = (row.querySelector<HTMLInputElement>('.hs-rec-name')?.value ?? '').trim();
      const type = (row.querySelector<HTMLSelectElement>('.hs-rec-type')?.value ?? '').trim();
      const value = (row.querySelector<HTMLInputElement>('.hs-rec-value')?.value ?? '').trim();
      if (name && value) extraRecords.push({ name, type, value });
    });

    try {
      const res = await fetch('/api/headscale/dns', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nameservers, domains, magicDns, overrideLocalDns, extraRecords }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? res.statusText);
      showToast('DNS config saved', 'success');
    } catch (err) {
      showToast(`Failed: ${err}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save DNS Config';
    }
  });

  // Delete record rows (event delegation)
  document.getElementById('hs-dns-extra-records')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('.hs-del-record');
    if (btn) btn.closest('.hs-extra-record-row')?.remove();
  });
}

function extraRecordRow(i: number, name: string, type: string, value: string): string {
  const types = ['A', 'AAAA', 'CNAME', 'MX', 'TXT'].map(t =>
    `<option value="${t}" ${t === type ? 'selected' : ''}>${t}</option>`
  ).join('');
  return `<div class="hs-extra-record-row hs-dns-record-row" data-idx="${i}">
    <input class="hs-rec-name settings-input" type="text" placeholder="hostname.example.com" value="${esc(name)}" style="font-family:var(--font-mono);font-size:11px" />
    <select class="hs-rec-type" style="background:rgba(0,0,0,.25);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:11px;padding:4px 6px">${types}</select>
    <input class="hs-rec-value settings-input" type="text" placeholder="1.2.3.4" value="${esc(value)}" style="font-family:var(--font-mono);font-size:11px" />
    <button class="hs-btn danger hs-del-record" title="Remove">✕</button>
  </div>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
