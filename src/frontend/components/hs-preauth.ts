import type { HeadscalePreauthKey, HeadscaleUser } from '../../backend/types.js';
import { showToast } from './toast.js';
import { showConfirm } from './dialog.js';

function buildTailscaleUpCmd(key: string, hsUrl: string): string {
  return `tailscale up --login-server=${hsUrl} --authkey=${key} --accept-routes --accept-dns=true --advertise-exit-node --advertise-routes <routes> --ssh`;
}

function buildPreauthCLICmd(userId: string, reusable: boolean, ephemeral: boolean, expiryIso: string, tagsRaw: string): string {
  let cmd = `headscale preauthkeys create --user ${userId}`;
  if (reusable) cmd += ' --reusable';
  if (ephemeral) cmd += ' --ephemeral';
  if (expiryIso) {
    const diffMs = new Date(expiryIso).getTime() - Date.now();
    const diffH = Math.round(diffMs / 3600000);
    if (diffH > 0) cmd += ` --expiration ${diffH}h`;
  }
  const tagList = tagsRaw.split(',').map(t => t.trim()).filter(Boolean).join(',');
  if (tagList) cmd += ` --tags ${tagList}`;
  return cmd;
}

export async function renderHsPreauth(container: HTMLElement): Promise<void> {
  const [usersRes, statusRes] = await Promise.all([
    fetch('/api/headscale/users'),
    fetch('/api/headscale/status'),
  ]);
  const usersData = await usersRes.json() as HeadscaleUser[] & { error?: string };
  if (!usersRes.ok || (usersData as { error?: string }).error) {
    container.innerHTML = `<div class="empty-state" style="color:#f87171">Failed to load users: ${(usersData as { error?: string }).error ?? usersRes.statusText}</div>`;
    return;
  }
  const users = usersData as HeadscaleUser[];
  if (users.length === 0) {
    container.innerHTML = '<div class="empty-state">No users found. Create a user first.</div>';
    return;
  }
  const statusData = await statusRes.json() as { url?: string };
  const hsUrl = statusData.url ?? 'http://localhost:8080';
  await render(container, users, users[0].name, hsUrl);
}

async function render(container: HTMLElement, users: HeadscaleUser[], selectedUser: string, hsUrl: string): Promise<void> {
  const keysRes = await fetch(`/api/headscale/preauthkeys?user=${encodeURIComponent(selectedUser)}`);
  const keysData = await keysRes.json() as HeadscalePreauthKey[] & { error?: string };
  if (!keysRes.ok || (keysData as { error?: string }).error) {
    container.innerHTML = `<div class="empty-state" style="color:#f87171">Failed to load pre-auth keys: ${(keysData as { error?: string }).error ?? keysRes.statusText}</div>`;
    return;
  }
  const keys = keysData as HeadscalePreauthKey[];

  const userOptions = users.map(u =>
    `<option value="${esc(u.name)}" data-id="${esc(u.id)}" ${u.name === selectedUser ? 'selected' : ''}>${esc(u.name)}</option>`
  ).join('');

  container.innerHTML = `
    <div class="hs-section-header">
      <span class="hs-section-title">Pre-auth Keys</span>
      <div class="hs-form-row">
        <label>User:</label>
        <select id="hs-preauth-user">${userOptions}</select>
      </div>
    </div>

    <div class="glass-card" style="padding:14px;margin-bottom:16px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent-purple);margin-bottom:10px">Create Key</div>
      <div class="hs-form-row" style="flex-wrap:wrap;gap:10px">
        <label class="toggle-switch" title="Reusable">
          <input type="checkbox" id="hs-pk-reusable" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
        <span style="font-size:12px;color:var(--text-muted)">Reusable</span>

        <label class="toggle-switch" title="Ephemeral">
          <input type="checkbox" id="hs-pk-ephemeral" />
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
        <span style="font-size:12px;color:var(--text-muted)">Ephemeral</span>

        <input type="datetime-local" id="hs-pk-expiry" style="background:rgba(0,0,0,.25);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:12px;padding:4px 8px;" title="Expiry (optional)" />

        <input type="text" id="hs-pk-tags" placeholder="tag:server,tag:prod" style="width:180px;background:rgba(0,0,0,.25);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:12px;padding:4px 8px;" />

        <button class="hs-btn primary" id="hs-create-pk-btn">Generate Key</button>
        <button class="hs-btn cli" id="hs-copy-pk-cli-btn" title="Copy CLI command to clipboard">$ copy cmd</button>
      </div>
      <div id="hs-pk-reveal" style="display:none" class="hs-key-reveal">
        <span class="hs-key-reveal-value" id="hs-pk-reveal-val"></span>
        <button class="hs-btn" id="hs-pk-copy-btn">Copy</button>
      </div>
    </div>

    <div id="hs-preauth-table">${buildTable(keys, hsUrl)}</div>
  `;

  document.getElementById('hs-preauth-user')?.addEventListener('change', async (e) => {
    const user = (e.target as HTMLSelectElement).value;
    await render(container, users, user, hsUrl);
  });

  document.getElementById('hs-copy-pk-cli-btn')?.addEventListener('click', () => {
    const sel = document.getElementById('hs-preauth-user') as HTMLSelectElement | null;
    const selectedOption = sel?.options[sel.selectedIndex];
    const userId = selectedOption?.dataset.id ?? selectedOption?.value ?? '';
    const reusable = (document.getElementById('hs-pk-reusable') as HTMLInputElement).checked;
    const ephemeral = (document.getElementById('hs-pk-ephemeral') as HTMLInputElement).checked;
    const expiryInput = (document.getElementById('hs-pk-expiry') as HTMLInputElement).value;
    const tagsInput = (document.getElementById('hs-pk-tags') as HTMLInputElement).value;
    const cmd = buildPreauthCLICmd(userId, reusable, ephemeral, expiryInput, tagsInput);
    navigator.clipboard.writeText(cmd).catch(() => {});
    showToast('Command copied', 'success');
  });

  document.getElementById('hs-create-pk-btn')?.addEventListener('click', async () => {
    const reusable = (document.getElementById('hs-pk-reusable') as HTMLInputElement).checked;
    const ephemeral = (document.getElementById('hs-pk-ephemeral') as HTMLInputElement).checked;
    const expiryInput = (document.getElementById('hs-pk-expiry') as HTMLInputElement).value;
    const tagsInput = (document.getElementById('hs-pk-tags') as HTMLInputElement).value;
    const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
    const expiration = expiryInput ? new Date(expiryInput).toISOString() : undefined;

    try {
      const res = await fetch('/api/headscale/preauthkeys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: selectedUser, reusable, ephemeral, expiration, tags }),
      });
      const data = await res.json() as HeadscalePreauthKey & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? res.statusText);

      // Show key once
      const reveal = document.getElementById('hs-pk-reveal');
      const revealVal = document.getElementById('hs-pk-reveal-val');
      if (reveal && revealVal) {
        revealVal.textContent = data.key;
        reveal.style.display = 'flex';
      }
      document.getElementById('hs-pk-copy-btn')?.addEventListener('click', () => {
        navigator.clipboard.writeText(data.key).catch(() => {});
        showToast('Key copied', 'success');
      }, { once: true });

      showToast('Pre-auth key created', 'success');
      const tableEl = document.getElementById('hs-preauth-table');
      if (tableEl) {
        const keysRes2 = await fetch(`/api/headscale/preauthkeys?user=${encodeURIComponent(selectedUser)}`);
        const keys2 = await keysRes2.json() as HeadscalePreauthKey[];
        tableEl.innerHTML = buildTable(keys2, hsUrl);
        attachTableActions(tableEl, users, selectedUser, container, hsUrl);
      }
    } catch (err) { showToast(`Failed: ${err}`, 'error'); }
  });

  const tableEl = document.getElementById('hs-preauth-table');
  if (tableEl) attachTableActions(tableEl, users, selectedUser, container, hsUrl);
}

function buildTable(keys: HeadscalePreauthKey[], hsUrl: string): string {
  if (keys.length === 0) return '<div class="empty-state" style="margin-top:8px">No pre-auth keys for this user</div>';

  const rows = keys.map(k => {
    const expired = k.expiration && new Date(k.expiration) < new Date();
    const status = k.used ? 'used' : expired ? 'expired' : 'online';
    const statusLabel = k.used ? 'used' : expired ? 'expired' : 'active';
    const expiry = k.expiration && !k.expiration.startsWith('0001') ? fmtDate(k.expiration) : 'Never';
    const tags = (k.aclTags ?? []).join(', ') || '—';
    const keyShort = k.key ? k.key.slice(0, 16) + '…' : '—';
    const userName = typeof k.user === 'object' ? k.user.name : String(k.user);
    const upCmd = esc(buildTailscaleUpCmd(k.key, hsUrl));

    return `<tr>
      <td style="font-family:var(--font-mono);font-size:11px">
        <span class="copyable" data-copy="${esc(k.key)}" title="${esc(k.key)}">${keyShort}</span>
      </td>
      <td><span class="hs-badge ${status}">${statusLabel}</span></td>
      <td style="font-size:11px">${k.reusable ? '✓' : '—'}</td>
      <td style="font-size:11px">${k.ephemeral ? '✓' : '—'}</td>
      <td style="font-size:11px;color:var(--text-muted)">${expiry}</td>
      <td style="font-size:11px;color:var(--text-muted)">${esc(tags)}</td>
      <td>
        <div class="actions">
          <button class="hs-btn cli hs-copy-up-btn" data-cmd="${upCmd}" title="Copy tailscale up command">$ up cmd</button>
          <button class="hs-btn danger hs-expire-pk-btn" data-user="${esc(userName)}" data-key="${esc(k.key)}" ${k.used || expired ? 'disabled' : ''}>Expire</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  return `<table class="hs-table">
    <thead><tr>
      <th>Key</th><th>Status</th><th>Reusable</th><th>Ephemeral</th><th>Expiry</th><th>Tags</th><th>Actions</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function attachTableActions(
  tableEl: HTMLElement,
  users: HeadscaleUser[],
  selectedUser: string,
  container: HTMLElement,
  _hsUrl: string
): void {
  tableEl.querySelectorAll<HTMLElement>('.hs-copy-up-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd ?? '';
      navigator.clipboard.writeText(cmd).catch(() => {});
      showToast('Command copied', 'success');
    });
  });

  tableEl.querySelectorAll<HTMLElement>('.hs-expire-pk-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await showConfirm({ title: 'Expire Key', message: 'This pre-auth key will stop working immediately.', confirmLabel: 'Expire', danger: true })) return;
      const user = btn.dataset.user!;
      const key = btn.dataset.key!;
      try {
        const res = await fetch('/api/headscale/preauthkeys/expire', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user, key }),
        });
        if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? res.statusText); }
        showToast('Key expired', 'success');
        await render(container, users, selectedUser);
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
