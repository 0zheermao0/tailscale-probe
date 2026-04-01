import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { TailscaleClient } from './tailscale-client.js';
import {
  TailscaleStatus,
  TailscalePeer,
  NetworkSnapshot,
  PeerSnapshot,
  ChangeEvent,
  ChangeType,
} from './types.js';

function peerToSnapshot(peer: TailscalePeer): PeerSnapshot {
  return {
    id: peer.PublicKey,
    hostname: peer.HostName,
    dnsName: peer.DNSName,
    ips: peer.TailscaleIPs ?? [],
    online: peer.Online,
    lastSeen: peer.LastSeen,
    lastHandshake: peer.LastHandshake,
    relay: peer.Relay ?? '',
    peerRelay: peer.PeerRelay ?? '',
    curAddr: peer.CurAddr ?? '',
    isExitNode: peer.ExitNode,
    isExitNodeOption: peer.ExitNodeOption,
    rxBytes: peer.RxBytes,
    txBytes: peer.TxBytes,
    os: peer.OS ?? '',
    active: peer.Active,
    nodeID: peer.ID,
    publicKey: peer.PublicKey,
    allowedIPs: peer.AllowedIPs ?? [],
    primaryRoutes: peer.PrimaryRoutes ?? [],
    addrs: peer.Addrs ?? [],
    created: peer.Created,
    lastWrite: peer.LastWrite,
    tags: peer.Tags ?? [],
    capMap: peer.CapMap ?? {},
    inNetworkMap: peer.InNetworkMap ?? false,
    inMagicSock: peer.InMagicSock ?? false,
    inEngine: peer.InEngine ?? false,
  };
}

function makeEvent(
  type: ChangeType,
  message: string,
  peer?: TailscalePeer,
  details?: Record<string, unknown>
): ChangeEvent {
  return {
    id: randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    peerID: peer?.PublicKey,
    peerName: peer?.HostName || peer?.DNSName,
    message,
    details,
  };
}

export class Monitor extends EventEmitter {
  private client: TailscaleClient;
  private interval: number;
  private timer: NodeJS.Timeout | null = null;
  private prevPeers: Map<string, TailscalePeer> = new Map();
  private prevExitNodeID: string | null = null;
  private daemonWasRunning: boolean | null = null;

  constructor(client: TailscaleClient, intervalSeconds: number) {
    super();
    this.client = client;
    this.interval = intervalSeconds * 1000;
  }

  start(): void {
    this.poll();
    this.timer = setInterval(() => this.poll(), this.interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.prevPeers.clear();
    this.prevExitNodeID = null;
    this.daemonWasRunning = null;
  }

  pollNow(): void {
    this.poll();
  }

  setInterval(seconds: number): void {
    this.interval = seconds * 1000;
    if (this.timer) {
      this.stop();
      this.start();
    }
  }

  private async poll(): Promise<void> {
    const status = await this.client.getStatus();

    if (!status) {
      if (this.daemonWasRunning !== false) {
        this.daemonWasRunning = false;
        const event = makeEvent('tailscale_daemon_lost', 'Tailscale daemon is unreachable');
        this.emit('change', [event]);
      }
      const snapshot: NetworkSnapshot = {
        timestamp: new Date().toISOString(),
        daemonRunning: false,
        backendState: 'NoState',
        tailnetName: '',
        self: {
          id: '', hostname: '', dnsName: '', ips: [],
          online: false, lastSeen: '', lastHandshake: '',
          relay: '', peerRelay: '', curAddr: '',
          isExitNode: false, isExitNodeOption: false,
          rxBytes: 0, txBytes: 0, os: '', active: false,
          nodeID: '', publicKey: '', allowedIPs: [],
          primaryRoutes: [], addrs: [], created: '',
          lastWrite: '', tags: [], capMap: {},
          inNetworkMap: false, inMagicSock: false, inEngine: false,
          loginName: '',
        },
        peers: [],
        exitNodeStatus: null,
        activeExitNodeID: null,
      };
      this.emit('snapshot', snapshot);
      return;
    }

    if (this.daemonWasRunning === false) {
      const event = makeEvent('tailscale_daemon_recovered', 'Tailscale daemon is back online');
      this.emit('change', [event]);
    }
    this.daemonWasRunning = true;

    const changes = this.diff(status);
    const snapshot = this.buildSnapshot(status);

    // Update previous state in-place to avoid allocating a new Map each poll
    const currentKeys = new Set(Object.keys(status.Peer ?? {}));
    for (const key of this.prevPeers.keys()) {
      if (!currentKeys.has(key)) this.prevPeers.delete(key);
    }
    for (const [k, v] of Object.entries(status.Peer ?? {})) {
      this.prevPeers.set(k, v);
    }
    this.prevExitNodeID = status.ExitNodeStatus?.ID ?? null;

    this.emit('snapshot', snapshot);
    if (changes.length > 0) {
      this.emit('change', changes);
    }
  }

  private diff(status: TailscaleStatus): ChangeEvent[] {
    const events: ChangeEvent[] = [];
    const currentPeers = status.Peer ?? {};

    for (const [key, peer] of Object.entries(currentPeers)) {
      const prev = this.prevPeers.get(key);

      if (!prev) {
        // New peer appeared — only emit if online
        if (peer.Online) {
          events.push(makeEvent('peer_online', `${peer.HostName} came online`, peer, {
            ips: peer.TailscaleIPs,
            relay: peer.Relay,
          }));
        }
        continue;
      }

      // Online/offline change
      if (!prev.Online && peer.Online) {
        events.push(makeEvent('peer_online', `${peer.HostName} came online`, peer, {
          ips: peer.TailscaleIPs,
        }));
      } else if (prev.Online && !peer.Online) {
        events.push(makeEvent('peer_offline', `${peer.HostName} went offline`, peer, {
          lastSeen: peer.LastSeen,
        }));
      }

      // Connection type change (direct ↔ relay)
      // CurAddr non-empty = direct connection; empty + Active = relayed via Relay field
      if (peer.Online && prev.Online) {
        const wasDirect = !!prev.CurAddr;
        const isDirect = !!peer.CurAddr;
        if (!wasDirect && isDirect) {
          events.push(makeEvent('connection_direct', `${peer.HostName} switched to direct connection`, peer, {
            addr: peer.CurAddr,
          }));
        } else if (wasDirect && !isDirect && peer.Active) {
          events.push(makeEvent('connection_relay', `${peer.HostName} switched to relay (${peer.Relay})`, peer, {
            relay: peer.Relay,
          }));
        }
      }
    }

    // Peers that disappeared
    for (const [key, prev] of this.prevPeers) {
      if (!currentPeers[key] && prev.Online) {
        events.push(makeEvent('peer_offline', `${prev.HostName} went offline`, prev));
      }
    }

    // Exit node changes
    const currentExitID = status.ExitNodeStatus?.ID ?? null;
    if (this.prevExitNodeID !== null && currentExitID === null) {
      events.push(makeEvent('exit_node_disconnected', 'Exit node disconnected', undefined, {
        previousID: this.prevExitNodeID,
      }));
    } else if (this.prevExitNodeID === null && currentExitID !== null) {
      const exitPeer = Object.values(currentPeers).find(p => p.ExitNode);
      events.push(makeEvent('exit_node_connected', `Connected to exit node: ${exitPeer?.HostName ?? currentExitID}`, exitPeer, {
        exitNodeID: currentExitID,
        online: status.ExitNodeStatus?.Online,
      }));
    } else if (this.prevExitNodeID !== null && currentExitID !== null && this.prevExitNodeID !== currentExitID) {
      const exitPeer = Object.values(currentPeers).find(p => p.ExitNode);
      events.push(makeEvent('exit_node_changed', `Exit node changed to: ${exitPeer?.HostName ?? currentExitID}`, exitPeer, {
        previousID: this.prevExitNodeID,
        newID: currentExitID,
      }));
    }

    return events;
  }

  private buildSnapshot(status: TailscaleStatus): NetworkSnapshot {
    const peers = Object.values(status.Peer ?? {}).map(peerToSnapshot);
    const activeExitNode = Object.values(status.Peer ?? {}).find(p => p.ExitNode);

    return {
      timestamp: new Date().toISOString(),
      daemonRunning: true,
      backendState: status.BackendState,
      tailnetName: status.CurrentTailnet?.Name ?? status.MagicDNSSuffix ?? '',
      self: {
        ...peerToSnapshot(status.Self),
        loginName: status.Self.LoginName ?? '',
      },
      peers,
      exitNodeStatus: status.ExitNodeStatus ?? null,
      activeExitNodeID: activeExitNode?.PublicKey ?? null,
    };
  }
}
