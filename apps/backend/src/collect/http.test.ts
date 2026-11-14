import {mkdtemp, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {
  HttpClient,
  HttpError,
  RobotsDisallowedError,
  USER_AGENT,
} from './http.js';
import {fakeNetwork, testClient} from './test-helpers.js';

const PAGE = 'https://shop.example/page';
const ROBOTS = 'https://shop.example/robots.txt';

describe('HttpClient', () => {
  it('fetches a page after checking robots.txt', async () => {
    const network = fakeNetwork({[PAGE]: {body: 'hello'}});
    const response = await testClient(network).get(PAGE);
    expect(response).toEqual({
      url: PAGE,
      finalUrl: PAGE,
      status: 200,
      body: 'hello',
    });
    expect(network.requests).toEqual([ROBOTS, PAGE]);
  });

  it('refuses a URL that robots.txt disallows', async () => {
    const network = fakeNetwork({
      [ROBOTS]: {body: 'User-agent: *\nDisallow: /page'},
      [PAGE]: {body: 'hello'},
    });
    await expect(testClient(network).get(PAGE)).rejects.toBeInstanceOf(
      RobotsDisallowedError,
    );
    expect(network.requests).toEqual([ROBOTS]);
  });

  it('reads robots.txt once per host', async () => {
    const network = fakeNetwork({[PAGE]: {body: 'a'}});
    const client = testClient(network);
    await client.get(PAGE);
    await client.get(`${PAGE}?b`);
    expect(network.requests.filter(url => url === ROBOTS)).toHaveLength(1);
  });

  it('reports the final URL after a redirect', async () => {
    const network = fakeNetwork({
      [PAGE]: {redirectTo: 'https://shop.example/home'},
      'https://shop.example/home': {body: 'home'},
    });
    const response = await testClient(network).get(PAGE);
    expect(response.finalUrl).toBe('https://shop.example/home');
  });

  it('returns client errors without retrying', async () => {
    const network = fakeNetwork({});
    const response = await testClient(network).get(PAGE);
    expect(response.status).toBe(404);
    expect(network.requests).toHaveLength(2);
  });

  it('retries server errors with backoff, three attempts at most', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const client = new HttpClient({
      cacheDir: null,
      date: '2026-11-14',
      now: () => 0,
      sleep: milliseconds => {
        sleeps.push(milliseconds);
        return Promise.resolve();
      },
      fetch: () => {
        calls++;
        return Promise.resolve(new Response('', {status: 503}));
      },
    });
    await expect(client.get(PAGE)).rejects.toThrow(/HTTP 503 after 3 attempts/);
    expect(calls).toBe(3);
    // Backoff of 1 s then 2 s, each followed by the per-host wait.
    expect(sleeps).toEqual([1000, 1000, 2000, 1000]);
  });

  it('recovers when a retry succeeds, and describes network errors', async () => {
    let calls = 0;
    const flaky = new HttpClient({
      cacheDir: null,
      date: '2026-11-14',
      sleep: () => Promise.resolve(),
      fetch: () => {
        calls++;
        return calls < 3
          ? Promise.reject(
              new TypeError('fetch failed', {cause: new Error('ECONNRESET')}),
            )
          : Promise.resolve(new Response('ok'));
      },
    });
    expect((await flaky.get(PAGE)).body).toBe('ok');

    const dead = new HttpClient({
      cacheDir: null,
      date: '2026-11-14',
      sleep: () => Promise.resolve(),
      // A rejection that is not an Error must still be reported.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberate
      fetch: () => Promise.reject('boom'),
    });
    await expect(dead.get(PAGE)).rejects.toBeInstanceOf(HttpError);
    await expect(dead.get(PAGE)).rejects.toThrow(/boom/);
  });

  it('waits one second between requests to the same host', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const client = new HttpClient({
      cacheDir: null,
      date: '2026-11-14',
      now: () => now,
      sleep: milliseconds => {
        sleeps.push(milliseconds);
        now += milliseconds;
        return Promise.resolve();
      },
      fetch: () => Promise.resolve(new Response('ok')),
    });
    await client.get(PAGE);
    now += 400;
    await client.get(`${PAGE}?2`);
    expect(sleeps).toEqual([1000, 600]);
    expect(client.networkRequests).toBe(3);
  });

  it('identifies itself with a descriptive user agent', async () => {
    let sent: string | null = null;
    const client = new HttpClient({
      cacheDir: null,
      date: '2026-11-14',
      sleep: () => Promise.resolve(),
      fetch: (_url, init) => {
        sent = new Headers(init?.headers).get('user-agent');
        return Promise.resolve(new Response('ok'));
      },
    });
    await client.get(PAGE);
    expect(sent).toBe(USER_AGENT);
    expect(USER_AGENT).toContain('mac-value-index');
  });

  it('caches responses by URL and date', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'mvi-cache-'));
    const network = fakeNetwork({[PAGE]: {body: 'cached'}});
    const options = {
      cacheDir,
      date: '2026-11-14',
      fetch: network.fetch,
      sleep: () => Promise.resolve(),
    };
    await new HttpClient(options).get(PAGE);
    const second = new HttpClient(options);
    expect((await second.get(PAGE)).body).toBe('cached');
    expect(second.networkRequests).toBe(0);
    expect(await readdir(path.join(cacheDir, '2026-11-14'))).toHaveLength(2);

    const nextDay = new HttpClient({...options, date: '2026-11-15'});
    await nextDay.get(PAGE);
    expect(nextDay.networkRequests).toBe(2);
  });
});
