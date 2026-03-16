/** Radar source plugin interface — each source produces URLs for the pipeline. */

export interface RadarSourceResult {
  url: string;
  title: string;
  snippet: string;
}

/** A radar source fetches candidate URLs from a specific platform. */
export interface RadarSource {
  readonly type: string;
  /** Fetch candidate URLs based on the query config. */
  fetch(params: string[], maxResults: number): Promise<RadarSourceResult[]>;
}
