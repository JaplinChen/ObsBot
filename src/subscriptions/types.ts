export interface Subscription {
  username: string;
  platform: 'threads';
  addedAt: string;
  lastCheckedAt?: string;
  lastPostUrl?: string;
  /** If set, only save posts classified into these categories. */
  allowedCategories?: string[];
}

export interface SubscriptionStore {
  version: 1;
  checkIntervalHours: number;
  subscriptions: Subscription[];
}
