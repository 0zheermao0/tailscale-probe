import {
  HeadscaleUser,
  HeadscaleNode,
  HeadscaleRoute,
  HeadscalePreauthKey,
  HeadscaleApiKey,
  HeadscalePolicy,
  HeadscaleDns,
} from './types.js';

export class HeadscaleClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  updateConfig(url: string, apiKey: string): void {
    this.baseUrl = url.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  async probe(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // Users
  async listUsers(): Promise<HeadscaleUser[]> {
    const data = await this.request<{ users: HeadscaleUser[] }>('GET', '/api/v1/user');
    return data.users ?? [];
  }

  async createUser(name: string): Promise<HeadscaleUser> {
    const data = await this.request<{ user: HeadscaleUser }>('POST', '/api/v1/user', { name });
    return data.user;
  }

  async deleteUser(name: string): Promise<void> {
    await this.request<unknown>('DELETE', `/api/v1/user/${encodeURIComponent(name)}`);
  }

  async renameUser(oldName: string, newName: string): Promise<HeadscaleUser> {
    const data = await this.request<{ user: HeadscaleUser }>(
      'POST',
      `/api/v1/user/${encodeURIComponent(oldName)}/rename/${encodeURIComponent(newName)}`
    );
    return data.user;
  }

  // Nodes
  async listNodes(user?: string): Promise<HeadscaleNode[]> {
    const qs = user ? `?user=${encodeURIComponent(user)}` : '';
    const data = await this.request<{ nodes: HeadscaleNode[] }>('GET', `/api/v1/node${qs}`);
    return data.nodes ?? [];
  }

  async deleteNode(id: string): Promise<void> {
    await this.request<unknown>('DELETE', `/api/v1/node/${id}`);
  }

  async expireNode(id: string): Promise<HeadscaleNode> {
    const data = await this.request<{ node: HeadscaleNode }>('POST', `/api/v1/node/${id}/expire`);
    return data.node;
  }

  async renameNode(id: string, newName: string): Promise<HeadscaleNode> {
    const data = await this.request<{ node: HeadscaleNode }>(
      'POST',
      `/api/v1/node/${id}/rename/${encodeURIComponent(newName)}`
    );
    return data.node;
  }

  async moveNode(id: string, user: string): Promise<HeadscaleNode> {
    const data = await this.request<{ node: HeadscaleNode }>(
      'POST',
      `/api/v1/node/${id}/user`,
      { user }
    );
    return data.node;
  }

  async tagNode(id: string, tags: string[]): Promise<HeadscaleNode> {
    const data = await this.request<{ node: HeadscaleNode }>(
      'POST',
      `/api/v1/node/${id}/tags`,
      { tags }
    );
    return data.node;
  }

  // Routes
  async listRoutes(): Promise<HeadscaleRoute[]> {
    const data = await this.request<{ routes: HeadscaleRoute[] }>('GET', '/api/v1/routes');
    return data.routes ?? [];
  }

  async getNodeRoutes(nodeId: string): Promise<HeadscaleRoute[]> {
    const data = await this.request<{ routes: HeadscaleRoute[] }>('GET', `/api/v1/node/${nodeId}/routes`);
    return data.routes ?? [];
  }

  async enableRoute(routeId: string): Promise<void> {
    await this.request<unknown>('POST', `/api/v1/routes/${routeId}/enable`);
  }

  async disableRoute(routeId: string): Promise<void> {
    await this.request<unknown>('POST', `/api/v1/routes/${routeId}/disable`);
  }

  async deleteRoute(routeId: string): Promise<void> {
    await this.request<unknown>('DELETE', `/api/v1/routes/${routeId}`);
  }

  // Pre-auth keys
  async listPreauthKeys(user: string): Promise<HeadscalePreauthKey[]> {
    const data = await this.request<{ preAuthKeys: HeadscalePreauthKey[] }>(
      'GET',
      `/api/v1/preauthkey?user=${encodeURIComponent(user)}`
    );
    return data.preAuthKeys ?? [];
  }

  async createPreauthKey(
    user: string,
    opts: { reusable?: boolean; ephemeral?: boolean; expiration?: string; tags?: string[] }
  ): Promise<HeadscalePreauthKey> {
    const data = await this.request<{ preAuthKey: HeadscalePreauthKey }>(
      'POST',
      '/api/v1/preauthkey',
      { user, ...opts }
    );
    return data.preAuthKey;
  }

  async expirePreauthKey(user: string, key: string): Promise<void> {
    await this.request<unknown>('POST', '/api/v1/preauthkey/expire', { user, key });
  }

  // ACL policy
  async getPolicy(): Promise<HeadscalePolicy> {
    return this.request<HeadscalePolicy>('GET', '/api/v1/policy');
  }

  async setPolicy(policy: string): Promise<HeadscalePolicy> {
    return this.request<HeadscalePolicy>('PUT', '/api/v1/policy', { policy });
  }

  // DNS
  async getDns(): Promise<HeadscaleDns> {
    return this.request<HeadscaleDns>('GET', '/api/v1/dns/settings');
  }

  async setDns(dns: Partial<HeadscaleDns>): Promise<HeadscaleDns> {
    return this.request<HeadscaleDns>('PUT', '/api/v1/dns/settings', dns);
  }

  // API keys
  async listApiKeys(): Promise<HeadscaleApiKey[]> {
    const data = await this.request<{ apiKeys: HeadscaleApiKey[] }>('GET', '/api/v1/apikey');
    return data.apiKeys ?? [];
  }

  async createApiKey(expiration?: string): Promise<{ apiKey: string }> {
    return this.request<{ apiKey: string }>('POST', '/api/v1/apikey', expiration ? { expiration } : {});
  }

  async expireApiKey(prefix: string): Promise<void> {
    await this.request<unknown>('POST', `/api/v1/apikey/${encodeURIComponent(prefix)}/expire`);
  }

  async deleteApiKey(prefix: string): Promise<void> {
    await this.request<unknown>('DELETE', `/api/v1/apikey/${encodeURIComponent(prefix)}`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const err = await res.json() as { message?: string };
        if (err.message) msg = err.message;
      } catch { /* ignore */ }
      throw new Error(msg);
    }

    // Some endpoints return empty body on success
    const text = await res.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }
}
