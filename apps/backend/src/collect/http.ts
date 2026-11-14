// Fetch wrapper used by every adapter: robots.txt check, one request per
// second per host, retry with backoff, an on-disk cache keyed by URL and
// date, and a descriptive user agent.

import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {z} from 'zod';

import {isAllowedByRobots} from './robots.js';

export const USER_AGENT =
  'mac-value-index/0.1 (+https://github.com/martinmayer-tech/mac-value-index; weekly price research)';

/** Token matched against User-agent lines in robots.txt. */
export const ROBOTS_TOKEN = 'mac-value-index';

const MIN_INTERVAL_MS = 1000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 1000;

const cachedResponseSchema = z.strictObject({
  url: z.string(),
  finalUrl: z.string(),
  status: z.number(),
  body: z.string(),
});
export type HttpResponse = z.infer<typeof cachedResponseSchema>;

export class RobotsDisallowedError extends Error {
  constructor(url: string) {
    super(`robots.txt disallows automated access to ${url}`);
    this.name = 'RobotsDisallowedError';
  }
}

export class HttpError extends Error {
  constructor(url: string, detail: string) {
    super(`GET ${url} failed: ${detail}`);
    this.name = 'HttpError';
  }
}

export interface HttpClientOptions {
  /** Directory for cached responses, or null to disable the cache. */
  readonly cacheDir: string | null;
  /** Date used in the cache key, so a new run re-fetches. */
  readonly date: string;
  readonly fetch?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => number;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause: unknown = error.cause;
    return cause instanceof Error
      ? `${error.message} (${cause.message})`
      : error.message;
  }
  return String(error);
}

export class HttpClient {
  private readonly cacheDir: string | null;
  private readonly date: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly lastRequestAt = new Map<string, number>();
  private readonly robots = new Map<string, Promise<string | null>>();
  /** Number of requests sent over the network (cache hits excluded). */
  networkRequests = 0;

  constructor(options: HttpClientOptions) {
    this.cacheDir = options.cacheDir;
    this.date = options.date;
    this.fetchFn = options.fetch ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
  }

  /** Fetches a page, honouring robots.txt, the rate limit and the cache. */
  async get(url: string): Promise<HttpResponse> {
    const robotsTxt = await this.robotsFor(new URL(url).origin);
    if (
      robotsTxt !== null &&
      !isAllowedByRobots(robotsTxt, ROBOTS_TOKEN, new URL(url))
    ) {
      throw new RobotsDisallowedError(url);
    }
    return this.fetchCached(url);
  }

  private robotsFor(origin: string): Promise<string | null> {
    const existing = this.robots.get(origin);
    if (existing !== undefined) {
      return existing;
    }
    const loading = this.fetchCached(`${origin}/robots.txt`).then(response =>
      // No robots.txt means no restrictions.
      response.status === 200 ? response.body : null,
    );
    this.robots.set(origin, loading);
    return loading;
  }

  private cacheFile(url: string): string | null {
    if (this.cacheDir === null) {
      return null;
    }
    const key = createHash('sha256').update(url).digest('hex');
    return path.join(this.cacheDir, this.date, `${key}.json`);
  }

  private async fetchCached(url: string): Promise<HttpResponse> {
    const file = this.cacheFile(url);
    if (file !== null) {
      try {
        const cached: unknown = JSON.parse(await readFile(file, 'utf8'));
        return cachedResponseSchema.parse(cached);
      } catch {
        // Not cached yet, or unreadable: fetch it.
      }
    }
    const response = await this.fetchWithRetry(url);
    if (file !== null) {
      await mkdir(path.dirname(file), {recursive: true});
      await writeFile(file, JSON.stringify(response), 'utf8');
    }
    return response;
  }

  private async waitForTurn(host: string): Promise<void> {
    const last = this.lastRequestAt.get(host);
    if (last !== undefined) {
      const wait = last + MIN_INTERVAL_MS - this.now();
      if (wait > 0) {
        await this.sleep(wait);
      }
    }
    this.lastRequestAt.set(host, this.now());
  }

  private async fetchWithRetry(url: string): Promise<HttpResponse> {
    const host = new URL(url).host;
    let failure = 'no attempt made';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        await this.sleep(BACKOFF_MS * 2 ** (attempt - 2));
      }
      await this.waitForTurn(host);
      this.networkRequests++;
      try {
        const response = await this.fetchFn(url, {
          headers: {'user-agent': USER_AGENT, accept: 'text/html,*/*'},
          redirect: 'follow',
        });
        if (!isRetryable(response.status)) {
          return {
            url,
            finalUrl: response.url === '' ? url : response.url,
            status: response.status,
            body: await response.text(),
          };
        }
        failure = `HTTP ${response.status}`;
      } catch (error) {
        failure = describe(error);
      }
    }
    throw new HttpError(url, `${failure} after ${MAX_ATTEMPTS} attempts`);
  }
}
