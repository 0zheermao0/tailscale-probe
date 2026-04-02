import { showToast } from './toast.js';

interface ConfigData {
  monitor?: { interval?: number };
  server?: { host?: string };
  headscale?: { url?: string; api_key?: string };
  notifications?: {
    dedupe_window_seconds?: number;
    telegram?: {
      enabled?: boolean;
      bot_token?: string;
      chat_id?: string;
      proxy?: string;
    };
    email?: {
      enabled?: boolean;
      smtp_host?: string;
      smtp_port?: number;
      secure?: boolean;
      username?: string;
      password?: string;
      from?: string;
      to?: string[];
      subject_prefix?: string;
    };
  };
}

export function initConfigPanel(): void {
  const btn = document.getElementById('config-btn');
  const drawer = document.getElementById('config-drawer');
  const overlay = document.getElementById('config-overlay');
  const closeBtn = document.getElementById('config-close');
  const form = document.getElementById('config-form') as HTMLFormElement | null;

  if (!btn || !drawer || !overlay || !closeBtn || !form) return;

  const open = () => {
    drawer.classList.add('open');
    overlay.classList.add('visible');
    loadConfig();
  };
  const close = () => {
    drawer.classList.remove('open');
    overlay.classList.remove('visible');
  };

  btn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', close);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveConfig(form);
  });

  document.addEventListener('config-updated', loadConfig);
}

async function loadConfig(): Promise<void> {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json() as ConfigData;
    populateForm(cfg);
  } catch (err) {
    console.error('Failed to load config:', err);
  }
}

function populateForm(cfg: ConfigData): void {
  const set = (id: string, value: unknown) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) return;
    if (el.type === 'checkbox') {
      el.checked = Boolean(value);
    } else {
      el.value = String(value ?? '');
    }
  };

  set('cfg-interval', cfg.monitor?.interval ?? 10);
  set('cfg-hs-url', cfg.headscale?.url ?? 'http://localhost:8080');
  set('cfg-hs-key', '');
  set('cfg-dedupe', cfg.notifications?.dedupe_window_seconds ?? 300);
  set('cfg-tg-enabled', cfg.notifications?.telegram?.enabled ?? false);
  set('cfg-tg-token', cfg.notifications?.telegram?.bot_token ?? '');
  set('cfg-tg-chat', cfg.notifications?.telegram?.chat_id ?? '');
  set('cfg-tg-proxy', cfg.notifications?.telegram?.proxy ?? '');
  set('cfg-email-enabled', cfg.notifications?.email?.enabled ?? false);
  set('cfg-email-host', cfg.notifications?.email?.smtp_host ?? '');
  set('cfg-email-port', cfg.notifications?.email?.smtp_port ?? 587);
  set('cfg-email-user', cfg.notifications?.email?.username ?? '');
  set('cfg-email-pass', '');
  set('cfg-email-from', cfg.notifications?.email?.from ?? '');
  set('cfg-email-to', (cfg.notifications?.email?.to ?? []).join(', '));
}

async function saveConfig(form: HTMLFormElement): Promise<void> {
  const get = (id: string): string => (document.getElementById(id) as HTMLInputElement)?.value ?? '';
  const getChecked = (id: string): boolean => (document.getElementById(id) as HTMLInputElement)?.checked ?? false;
  const getNum = (id: string): number => parseInt(get(id)) || 0;

  const toEmails = get('cfg-email-to').split(',').map(s => s.trim()).filter(Boolean);

  const hsKey = get('cfg-hs-key');
  const tgToken = get('cfg-tg-token');
  const emailPass = get('cfg-email-pass');
  const patch: ConfigData = {
    monitor: { interval: getNum('cfg-interval') },
    headscale: {
      url: get('cfg-hs-url') || 'http://localhost:8080',
      ...(hsKey ? { api_key: hsKey } : {}),
    },
    notifications: {
      dedupe_window_seconds: getNum('cfg-dedupe'),
      telegram: {
        enabled: getChecked('cfg-tg-enabled'),
        ...(tgToken && tgToken !== '***' ? { bot_token: tgToken } : {}),
        chat_id: get('cfg-tg-chat'),
        proxy: get('cfg-tg-proxy'),
      },
      email: {
        enabled: getChecked('cfg-email-enabled'),
        smtp_host: get('cfg-email-host'),
        smtp_port: getNum('cfg-email-port'),
        username: get('cfg-email-user'),
        ...(emailPass ? { password: emailPass } : {}),
        from: get('cfg-email-from'),
        to: toEmails,
      },
    },
  };

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json() as { ok: boolean; error?: string };
    if (data.ok) {
      showToast('Configuration saved', 'success');
    } else {
      showToast(`Save failed: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Save failed: ${err}`, 'error');
  }
}
