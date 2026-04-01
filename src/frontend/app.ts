import { SSEClient } from './sse-client.js';
import { initRenderer } from './renderer.js';
import { initConfigPanel } from './components/config-panel.js';
import { initPeerDetailModal } from './components/peer-detail-modal.js';
import { initNodeSettings } from './components/node-settings.js';
import { initHeadscalePanel } from './components/headscale-panel.js';

document.addEventListener('DOMContentLoaded', () => {
  initRenderer();
  initConfigPanel();
  initPeerDetailModal();
  initNodeSettings();
  initHeadscalePanel();

  const sse = new SSEClient();
  sse.connect();
});
