export interface FailedUrl {
  url: string;
  hash: string;
  error: string;
  timestamp: number;
}

export interface BotStats {
  urls: number;
  saved: number;
  errors: number;
  recent: string[];
  failedUrls: FailedUrl[];
}
