import { readFileSync, existsSync, writeFileSync } from 'fs';
import { EventEmitter } from 'events';
import yaml from 'js-yaml';
import chokidar from 'chokidar';
import { AppConfig, defaultConfig } from './types.js';

function deepMerge<T>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof T)[]) {
    const val = override[key];
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      result[key] = deepMerge(base[key] as object, val as object) as T[keyof T];
    } else if (val !== undefined) {
      result[key] = val as T[keyof T];
    }
  }
  return result;
}

export class ConfigManager extends EventEmitter {
  private config: AppConfig;
  private configPath: string;
  private watcher: chokidar.FSWatcher | null = null;

  constructor(configPath: string) {
    super();
    this.configPath = configPath;
    this.config = this.load();
  }

  private load(): AppConfig {
    if (!existsSync(this.configPath)) {
      console.warn(`Config file not found at ${this.configPath}, using defaults`);
      return structuredClone(defaultConfig);
    }
    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      const parsed = yaml.load(raw) as Partial<AppConfig>;
      return deepMerge(defaultConfig, parsed ?? {});
    } catch (err) {
      console.error(`Failed to parse config file: ${err}`);
      return structuredClone(defaultConfig);
    }
  }

  get(): AppConfig {
    return this.config;
  }

  save(newConfig: AppConfig): void {
    const yamlStr = yaml.dump(newConfig, { indent: 2 });
    writeFileSync(this.configPath, yamlStr, 'utf-8');
    // chokidar will pick up the change and reload
  }

  startWatching(): void {
    this.watcher = chokidar.watch(this.configPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });

    this.watcher.on('change', () => {
      console.log(`Config file changed, reloading...`);
      const prev = this.config;
      try {
        this.config = this.load();
        console.log('Config reloaded successfully');
        this.emit('config_changed', this.config, prev);
      } catch (err) {
        console.error(`Config reload failed: ${err}`);
        this.emit('config_error', err);
      }
    });
  }

  stopWatching(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  update(patch: Partial<AppConfig>): void {
    this.config = deepMerge(this.config, patch);
    this.save(this.config);
  }

  getSanitized(): Partial<AppConfig> {
    const cfg = structuredClone(this.config);
    if (cfg.notifications.telegram.bot_token) {
      cfg.notifications.telegram.bot_token = '***';
    }
    if (cfg.notifications.email.password) {
      cfg.notifications.email.password = '***';
    }
    return cfg;
  }
}
