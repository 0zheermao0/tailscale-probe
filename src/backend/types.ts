// Tailscale local API response types

export interface TailscalePeer {
  ID: string;
  PublicKey: string;
  HostName: string;
  DNSName: string;
  OS: string;
  UserID: number;
  TailscaleIPs: string[];
  AllowedIPs: string[];
  Addrs: string[] | null;
  CurAddr: string;
  Relay: string;
  PeerRelay: string;
  RxBytes: number;
  TxBytes: number;
  Created: string;
  LastWrite: string;
  LastSeen: string;
  LastHandshake: string;
  Online: boolean;
  KeepAlive: boolean;
  ExitNode: boolean;
  ExitNodeOption: boolean;
  Active: boolean;
  PeerAPIURL: string[];
  Capabilities: string[];
  CapMap: Record<string, unknown[]> | null;
  InNetworkMap: boolean;
  InMagicSock: boolean;
  InEngine: boolean;
  PrimaryRoutes: string[] | null;
  Tags: string[] | null;
}

export interface TailscaleSelf extends TailscalePeer {
  MachineStatus: string;
  LoginName: string;
}

export interface ExitNodeStatus {
  ID: string;
  Online: boolean;
  TailscaleIPs: string[];
}

export interface TailscaleStatus {
  BackendState: string;
  AuthURL: string;
  TailscaleIPs: string[];
  Self: TailscaleSelf;
  Health: string[] | null;
  MagicDNSSuffix: string;
  CurrentTailnet: {
    Name: string;
    MagicDNSSuffix: string;
    MagicDNSEnabled: boolean;
  } | null;
  CertDomains: string[] | null;
  Peer: Record<string, TailscalePeer>;
  User: Record<string, unknown>;
  ClientVersion: {
    RunningVersion: string;
    LatestVersion: string | null;
    Urgency: string | null;
    Message: string;
    URL: string;
  } | null;
  ExitNodeStatus: ExitNodeStatus | null;
}

export interface TailscalePrefs {
  ControlURL: string;
  RouteAll: boolean;
  ExitNodeID: string;
  ExitNodeIP: string;
  ExitNodeAllowLANAccess: boolean;
  CorpDNS: boolean;
  RunSSH: boolean;
  RunWebClient: boolean;
  WantRunning: boolean;
  ShieldsUp: boolean;
  AdvertiseTags: string[] | null;
  Hostname: string;
  AdvertiseRoutes: string[] | null;
  NoSNAT: boolean;
  NoStatefulFiltering: boolean;
  AutoUpdate: { Check: boolean; Apply: boolean | null };
  AppConnector: { Advertise: boolean };
  PostureChecking: boolean;
  AllowSingleHosts: boolean;
}

// Internal monitoring types

export type ChangeType =
  | 'peer_online'
  | 'peer_offline'
  | 'exit_node_connected'
  | 'exit_node_disconnected'
  | 'exit_node_changed'
  | 'connection_direct'
  | 'connection_relay'
  | 'tailscale_daemon_lost'
  | 'tailscale_daemon_recovered';

export interface ChangeEvent {
  id: string;
  type: ChangeType;
  timestamp: string;
  peerID?: string;
  peerName?: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PeerSnapshot {
  id: string;
  hostname: string;
  dnsName: string;
  ips: string[];
  online: boolean;
  lastSeen: string;
  lastHandshake: string;
  relay: string;
  peerRelay: string;
  curAddr: string;
  isExitNode: boolean;
  isExitNodeOption: boolean;
  rxBytes: number;
  txBytes: number;
  os: string;
  active: boolean;
  // Extended fields for detail modal
  nodeID: string;
  publicKey: string;
  allowedIPs: string[];
  primaryRoutes: string[];
  addrs: string[];
  created: string;
  lastWrite: string;
  tags: string[];
  capMap: Record<string, unknown[]>;
  inNetworkMap: boolean;
  inMagicSock: boolean;
  inEngine: boolean;
}

export interface NetworkSnapshot {
  timestamp: string;
  daemonRunning: boolean;
  backendState: string;
  tailnetName: string;
  self: PeerSnapshot & { loginName: string };
  peers: PeerSnapshot[];
  exitNodeStatus: ExitNodeStatus | null;
  activeExitNodeID: string | null;
}

// Headscale types

export interface HeadscaleUser {
  id: string;
  name: string;
  createdAt: string;
}

export interface HeadscaleRoute {
  id: string;
  node: { id: string; name: string };
  prefix: string;
  advertised: boolean;
  enabled: boolean;
  isPrimary: boolean;
}

export interface HeadscaleNode {
  id: string;
  machineKey: string;
  nodeKey: string;
  discoKey: string;
  ipAddresses: string[];
  name: string;
  user: HeadscaleUser;
  lastSeen: string;
  lastSuccessfulUpdate: string;
  expiry: string;
  online: boolean;
  validTags: string[];
  invalidTags: string[];
  forcedTags: string[];
  registerMethod: string;
  os: string;
  routes: HeadscaleRoute[];
}

export interface HeadscalePreauthKey {
  id: string;
  key: string;
  reusable: boolean;
  ephemeral: boolean;
  used: boolean;
  expiration: string;
  createdAt: string;
  user: HeadscaleUser;
  aclTags: string[];
}

export interface HeadscaleApiKey {
  id: string;
  prefix: string;
  expiration: string;
  createdAt: string;
  lastSeen: string;
}

export interface HeadscalePolicy {
  policy: string;
  updatedAt: string;
}

export interface HeadscaleDns {
  overrideLocalDns: boolean;
  nameservers: string[];
  restrictedNameservers: Record<string, string[]>;
  domains: string[];
  magicDns: boolean;
  baseDomain: string;
  extraRecords: Array<{ name: string; type: string; value: string }>;
}

// Config types

export interface AppConfig {
  monitor: {
    interval: number;
    tailscale_socket: string;
    tailscale_http_addr: string;
    tailscale_cli: string;
    history_size: number;
  };
  server: {
    host: string;
  };
  headscale: {
    url: string;
    api_key: string;
  };
  notifications: {
    dedupe_window_seconds: number;
    telegram: {
      enabled: boolean;
      bot_token: string;
      chat_id: string;
      parse_mode: string;
    };
    email: {
      enabled: boolean;
      smtp_host: string;
      smtp_port: number;
      secure: boolean;
      username: string;
      password: string;
      from: string;
      to: string[];
      subject_prefix: string;
    };
  };
}

export const defaultConfig: AppConfig = {
  monitor: {
    interval: 10,
    tailscale_socket: '/var/run/tailscale/tailscaled.sock',
    tailscale_http_addr: 'http://localhost:41112',
    tailscale_cli: '',
    history_size: 100,
  },
  server: {
    host: '0.0.0.0',
  },
  headscale: {
    url: 'http://localhost:8080',
    api_key: '',
  },
  notifications: {
    dedupe_window_seconds: 300,
    telegram: {
      enabled: false,
      bot_token: '',
      chat_id: '',
      parse_mode: 'HTML',
    },
    email: {
      enabled: false,
      smtp_host: 'smtp.gmail.com',
      smtp_port: 587,
      secure: false,
      username: '',
      password: '',
      from: '',
      to: [],
      subject_prefix: '[Tailscale Probe]',
    },
  },
};
