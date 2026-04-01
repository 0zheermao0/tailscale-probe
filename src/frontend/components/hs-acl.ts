import type { HeadscalePolicy } from '../../backend/types.js';
import { showToast } from './toast.js';

export async function renderHsAcl(container: HTMLElement): Promise<void> {
  const res = await fetch('/api/headscale/policy');
  const data = await res.json() as HeadscalePolicy & { error?: string };
  if (!res.ok || data.error) {
    container.innerHTML = `<div class="empty-state" style="color:#f87171">Failed to load ACL: ${data.error ?? res.statusText}</div>`;
    return;
  }
  render(container, data);
}

function render(container: HTMLElement, policy: HeadscalePolicy): void {
  const updatedAt = policy.updatedAt ? fmtDate(policy.updatedAt) : '—';

  container.innerHTML = `
    <div class="hs-section-header">
      <span class="hs-section-title">ACL Policy</span>
      <span style="font-size:11px;color:var(--text-muted)">Last updated: ${updatedAt}</span>
    </div>
    <div style="margin-bottom:8px;font-size:11px;color:var(--text-muted)">
      HuJSON format — supports <code style="font-family:var(--font-mono)">//</code> comments and trailing commas.
    </div>
    <textarea class="hs-acl-editor" id="hs-acl-textarea" spellcheck="false">${escText(policy.policy ?? '')}</textarea>
    <div style="display:flex;align-items:center;gap:10px;margin-top:10px">
      <button class="hs-btn primary" id="hs-acl-save-btn">Save Policy</button>
      <button class="hs-btn" id="hs-acl-reload-btn">Reload</button>
      <span id="hs-acl-status" style="font-size:11px;color:var(--text-muted)"></span>
    </div>
  `;

  document.getElementById('hs-acl-save-btn')?.addEventListener('click', async () => {
    const textarea = document.getElementById('hs-acl-textarea') as HTMLTextAreaElement | null;
    const status = document.getElementById('hs-acl-status');
    if (!textarea) return;

    const btn = document.getElementById('hs-acl-save-btn') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    if (status) status.textContent = '';

    try {
      const res = await fetch('/api/headscale/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy: textarea.value }),
      });
      const data = await res.json() as HeadscalePolicy & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? res.statusText);
      showToast('ACL policy saved', 'success');
      if (status) status.textContent = `Saved at ${new Date().toLocaleTimeString()}`;
    } catch (err) {
      showToast(`Failed: ${err}`, 'error');
      if (status) { status.textContent = String(err); status.style.color = '#f87171'; }
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Policy';
    }
  });

  document.getElementById('hs-acl-reload-btn')?.addEventListener('click', async () => {
    container.innerHTML = '<div class="empty-state">Loading…</div>';
    await renderHsAcl(container);
  });
}

function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
