/**
 * Plugin system types — defines the contract between KnowPipe and external plugins.
 */
import type { ExtractedContent } from '../extractors/types.js';

/** Plugin manifest (loaded from manifest.json in plugin directory). */
export interface PluginManifest {
  name: string;
  version: string;
  /** Platform identifier for extracted content */
  platform: string;
  /** URL patterns this plugin handles (substring match) */
  urlPatterns: string[];
  /** Entry point file relative to plugin directory */
  entrypoint: string;
  /** Optional description */
  description?: string;
}

/** Restricted API surface provided to plugins. */
export interface PluginContext {
  /** Fetch a URL with timeout */
  fetchWithTimeout: (url: string, opts?: RequestInit & { timeoutMs?: number }) => Promise<Response>;
  /** Call oMLX for AI enrichment (returns null if unavailable) */
  aiComplete: (prompt: string, opts?: { timeoutMs?: number; maxTokens?: number }) => Promise<string | null>;
  /** Scoped logger */
  log: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

/** Plugin extractor — what a plugin module must export. */
export interface PluginExtractor {
  /** Initialize the plugin with context. Called once at load time. */
  init?: (ctx: PluginContext) => void | Promise<void>;
  /** Test if this plugin handles the given URL. */
  match: (url: string) => boolean;
  /** Extract content from a URL. */
  extract: (url: string, ctx: PluginContext) => Promise<ExtractedContent>;
}

/** A loaded plugin with its manifest and extractor. */
export interface LoadedPlugin {
  manifest: PluginManifest;
  extractor: PluginExtractor;
}
