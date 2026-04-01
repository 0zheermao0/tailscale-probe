import { store } from './store.js';
import type { NetworkSnapshot, ChangeEvent } from '../backend/types.js';
import { showToast } from './components/toast.js';

const TOAST_TYPES: Record<string, 'success' | 'error' | 'warning' | 'info'> = {
  peer_online: 'success',
  peer_offline: 'error',
  exit_node_connected: 'success',
  exit_node_disconnected: 'warning',
  exit_node_changed: 'info',
  connection_direct: 'success',
  connection_relay: 'info',
  tailscale_daemon_lost: 'error',
  tailscale_daemon_recovered: 'success',
};

export class SSEClient {
  private es: EventSource | null = null;
  private retryDelay = 1000;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  connect(): void {
    if (this.es) {
      this.es.onerror = null;
      this.es.close();
      this.es = null;
    }

    this.es = new EventSource('/api/events');

    this.es.addEventListener('snapshot', (e: MessageEvent) => {
      const snapshot = JSON.parse(e.data) as NetworkSnapshot | null;
      store.setSnapshot(snapshot);
      store.setConnected(true);
      this.retryDelay = 1000;
    });

    this.es.addEventListener('history', (e: MessageEvent) => {
      const history = JSON.parse(e.data) as ChangeEvent[];
      store.setHistory(history);
    });

    this.es.addEventListener('change', (e: MessageEvent) => {
      const events = JSON.parse(e.data) as ChangeEvent[];
      store.addChanges(events);
      for (const event of events) {
        const toastType = TOAST_TYPES[event.type] ?? 'info';
        showToast(event.message, toastType);
      }
    });

    this.es.addEventListener('config_updated', () => {
      // Config changed — could refresh config panel
      document.dispatchEvent(new CustomEvent('config-updated'));
    });

    this.es.addEventListener('error', (e: MessageEvent) => {
      showToast(e.data ? JSON.parse(e.data).message : 'Server error', 'error');
    });

    this.es.onerror = () => {
      store.setConnected(false);
      this.es?.close();
      this.es = null;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.retryDelay = Math.min(this.retryDelay * 2, 30000);
      this.connect();
    }, this.retryDelay);
  }

  disconnect(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.es?.close();
    this.es = null;
  }
}
