/**
 * Persistent storage for user subscriptions.
 * Data stored in data/subscriptions.json.
 */
import { join } from 'node:path';
import { logger } from '../core/logger.js';
import { safeWriteJSON, safeReadJSON } from '../core/safe-write.js';
import type { SubscriptionStore, Subscription } from './types.js';

const STORE_PATH = join(process.cwd(), 'data', 'subscriptions.json');

function createEmpty(): SubscriptionStore {
  return { version: 1, checkIntervalHours: 12, subscriptions: [] };
}

export async function loadSubscriptions(): Promise<SubscriptionStore> {
  return safeReadJSON<SubscriptionStore>(STORE_PATH, createEmpty());
}

export async function saveSubscriptions(store: SubscriptionStore): Promise<void> {
  await safeWriteJSON(STORE_PATH, store);
  logger.info('subscribe', '已儲存訂閱', { count: store.subscriptions.length });
}

export function addSubscription(
  store: SubscriptionStore, username: string, platform: 'threads' = 'threads',
): boolean {
  const normalized = username.replace(/^@/, '').toLowerCase();
  if (store.subscriptions.some(s => s.username === normalized && s.platform === platform)) {
    return false; // already exists
  }
  store.subscriptions.push({
    username: normalized,
    platform,
    addedAt: new Date().toISOString(),
  });
  return true;
}

export function removeSubscription(store: SubscriptionStore, username: string): boolean {
  const normalized = username.replace(/^@/, '').toLowerCase();
  const idx = store.subscriptions.findIndex(s => s.username === normalized);
  if (idx < 0) return false;
  store.subscriptions.splice(idx, 1);
  return true;
}

export function getSubscription(
  store: SubscriptionStore, username: string,
): Subscription | undefined {
  const normalized = username.replace(/^@/, '').toLowerCase();
  return store.subscriptions.find(s => s.username === normalized);
}
