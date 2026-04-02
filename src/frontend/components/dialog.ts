let overlayEl: HTMLElement;
let dialogEl: HTMLElement;
let titleEl: HTMLElement;
let messageEl: HTMLElement;
let inputEl: HTMLInputElement;
let confirmBtn: HTMLButtonElement;
let cancelBtn: HTMLButtonElement;
let closeBtn: HTMLButtonElement;
let initialized = false;

function init(): void {
  if (initialized) return;
  initialized = true;

  overlayEl = document.createElement('div');
  overlayEl.className = 'hs-dialog-overlay';

  dialogEl = document.createElement('div');
  dialogEl.className = 'hs-dialog glass-card';
  dialogEl.setAttribute('role', 'dialog');
  dialogEl.setAttribute('aria-modal', 'true');
  dialogEl.innerHTML = `
    <div class="hs-dialog-header">
      <span class="hs-dialog-title" id="hs-dialog-title"></span>
      <button class="drawer-close" id="hs-dialog-close">✕</button>
    </div>
    <div class="hs-dialog-body">
      <p class="hs-dialog-message" id="hs-dialog-message"></p>
      <input class="settings-input hs-dialog-input" id="hs-dialog-input" type="text" />
    </div>
    <div class="hs-dialog-footer">
      <button class="hs-btn" id="hs-dialog-cancel">Cancel</button>
      <button class="hs-btn primary" id="hs-dialog-confirm">Confirm</button>
    </div>
  `;

  document.body.appendChild(overlayEl);
  document.body.appendChild(dialogEl);

  titleEl    = document.getElementById('hs-dialog-title')!;
  messageEl  = document.getElementById('hs-dialog-message')!;
  inputEl    = document.getElementById('hs-dialog-input') as HTMLInputElement;
  confirmBtn = document.getElementById('hs-dialog-confirm') as HTMLButtonElement;
  cancelBtn  = document.getElementById('hs-dialog-cancel') as HTMLButtonElement;
  closeBtn   = document.getElementById('hs-dialog-close') as HTMLButtonElement;
}

function show(): void {
  overlayEl.classList.add('visible');
  dialogEl.classList.add('visible');
}

function hide(): void {
  overlayEl.classList.remove('visible');
  dialogEl.classList.remove('visible');
}

export function showConfirm(opts: {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  init();
  return new Promise(resolve => {
    titleEl.textContent = opts.title;
    messageEl.textContent = opts.message;
    messageEl.style.display = '';
    inputEl.style.display = 'none';
    confirmBtn.textContent = opts.confirmLabel ?? 'Confirm';
    confirmBtn.className = `hs-btn ${opts.danger ? 'danger' : 'primary'}`;

    const finish = (val: boolean) => {
      hide();
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(false);
    };

    confirmBtn.addEventListener('click', () => finish(true), { once: true });
    cancelBtn.addEventListener('click', () => finish(false), { once: true });
    closeBtn.addEventListener('click', () => finish(false), { once: true });
    overlayEl.addEventListener('click', () => finish(false), { once: true });
    document.addEventListener('keydown', onKey);

    show();
  });
}

export function showInput(opts: {
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
}): Promise<string | null> {
  init();
  return new Promise(resolve => {
    titleEl.textContent = opts.title;
    if (opts.message) {
      messageEl.textContent = opts.message;
      messageEl.style.display = '';
    } else {
      messageEl.style.display = 'none';
    }
    inputEl.style.display = '';
    inputEl.placeholder = opts.placeholder ?? '';
    inputEl.value = opts.defaultValue ?? '';
    confirmBtn.textContent = opts.confirmLabel ?? 'Save';
    confirmBtn.className = 'hs-btn primary';

    const finish = (val: string | null) => {
      hide();
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        finish(null);
      } else if (e.key === 'Enter' && document.activeElement === inputEl) {
        finish(inputEl.value.trim() || null);
      }
    };

    confirmBtn.addEventListener('click', () => finish(inputEl.value.trim() || null), { once: true });
    cancelBtn.addEventListener('click', () => finish(null), { once: true });
    closeBtn.addEventListener('click', () => finish(null), { once: true });
    overlayEl.addEventListener('click', () => finish(null), { once: true });
    document.addEventListener('keydown', onKey);

    show();
    setTimeout(() => { inputEl.focus(); inputEl.select(); }, 50);
  });
}
