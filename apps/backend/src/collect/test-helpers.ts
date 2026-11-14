// Test helpers: a fake fetch that serves recorded pages by URL.

import {readFile} from 'node:fs/promises';
import path from 'node:path';

import {HttpClient} from './http.js';

const FIXTURES = path.join(import.meta.dirname, '..', '..', 'test', 'fixtures');

export async function fixture(name: string): Promise<string> {
  return readFile(path.join(FIXTURES, name), 'utf8');
}

export interface Route {
  readonly status?: number;
  readonly body?: string;
  /** URL the request redirects to. */
  readonly redirectTo?: string;
}

export interface FakeNetwork {
  readonly fetch: typeof fetch;
  readonly requests: string[];
}

/** Builds a fetch that answers from a URL map; unknown URLs return 404. */
export function fakeNetwork(
  routes: Readonly<Record<string, Route>>,
): FakeNetwork {
  const requests: string[] = [];
  const fakeFetch: typeof fetch = input => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push(url);
    let route = routes[url];
    let finalUrl = url;
    if (route?.redirectTo !== undefined) {
      finalUrl = route.redirectTo;
      route = routes[finalUrl];
    }
    const response = new Response(route?.body ?? '', {
      status: route?.status ?? (route === undefined ? 404 : 200),
    });
    Object.defineProperty(response, 'url', {value: finalUrl});
    return Promise.resolve(response);
  };
  return {fetch: fakeFetch, requests};
}

/** An HTTP client with no cache and no real waiting. */
export function testClient(network: FakeNetwork): HttpClient {
  return new HttpClient({
    cacheDir: null,
    date: '2026-11-14',
    fetch: network.fetch,
    sleep: () => Promise.resolve(),
  });
}
