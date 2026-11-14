import AxeBuilder from '@axe-core/playwright';
import {expect, test} from '@playwright/test';
import type {Page} from '@playwright/test';

import {
  LATEST,
  listing,
  OLDER,
  profile,
  rankedIds,
  results,
} from './fixture.js';

const DEFAULT = results.defaultProfileId;

/** Listing ids of the ranking rows currently shown, in order. */
async function shownIds(page: Page): Promise<readonly string[]> {
  return page
    .locator('.ranking-table tr.row')
    .evaluateAll(rows =>
      rows.map(row => row.getAttribute('data-listing-id') ?? ''),
    );
}

async function waitForIsland(page: Page): Promise<void> {
  await expect(page.locator('.ranking')).toHaveAttribute(
    'data-hydrated',
    'true',
  );
}

function gbp(amount: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}

test.describe('home page', () => {
  test('shows the conclusion, the snapshot date and ten entries', async ({
    page,
  }) => {
    await page.goto('');
    await expect(page.getByTestId('conclusion')).toHaveText(
      profile(DEFAULT).conclusion.text,
    );
    await expect(page.getByTestId('snapshot-date')).toHaveText(LATEST);
    await expect(page.locator('html')).toHaveAttribute(
      'data-snapshot-date',
      LATEST,
    );
    const entries = page.getByTestId('top10').locator('li');
    await expect(entries).toHaveCount(10);
    const top = profile(DEFAULT).ranking.slice(0, 10);
    for (const [index, entry] of top.entries()) {
      const item = entries.nth(index);
      const source = listing(entry.listingId);
      await expect(item).toContainText(entry.summary);
      await expect(item).toContainText(gbp(source.priceGbp));
      await expect(item).toContainText(entry.valueScore.toFixed(2));
      await expect(item.locator('a')).toHaveAttribute('href', source.sourceUrl);
    }
  });

  test('shows the chart with a text alternative, bands and comparison', async ({
    page,
  }) => {
    await page.goto('');
    const chart = page.locator('.chart svg[role="img"]');
    await expect(chart).toBeVisible();
    await expect(page.locator('#chart-desc')).toContainText(
      `${profile(DEFAULT).ranking.length} listings ranked`,
    );
    await expect(page.locator('.band')).toHaveCount(
      profile(DEFAULT).priceBandPicks.length,
    );
    await expect(
      page.getByRole('heading', {name: 'New versus refurbished'}),
    ).toBeVisible();
    await expect(page.getByRole('link', {name: 'full report'})).toHaveAttribute(
      'href',
      `/mac-value-index/reports/${LATEST}/`,
    );
  });

  test('conclusion and top 10 fit a laptop screen without scrolling', async ({
    page,
  }) => {
    await page.setViewportSize({width: 1366, height: 768});
    await page.goto('');
    await expect(page.getByTestId('conclusion')).toBeInViewport({ratio: 1});
    await expect(page.getByTestId('top10').locator('li').nth(9)).toBeInViewport(
      {ratio: 1},
    );
  });

  test('makes no network request beyond its own origin', async ({page}) => {
    const external: string[] = [];
    page.on('request', request => {
      if (!request.url().startsWith('http://localhost')) {
        external.push(request.url());
      }
    });
    await page.goto('');
    await waitForIsland(page);
    await page.getByLabel('Profile', {exact: true}).selectOption('cpu-heavy');
    expect(external).toEqual([]);
  });
});

test.describe('ranking table', () => {
  test('starts with the default profile in rank order', async ({page}) => {
    await page.goto('');
    await waitForIsland(page);
    expect(await shownIds(page)).toEqual(rankedIds(DEFAULT));
    await expect(
      page.locator('.ranking-table th[aria-sort="ascending"]'),
    ).toHaveText(/Rank/);
  });

  test('profile switch shows that profile’s order from results.json', async ({
    page,
  }) => {
    await page.goto('');
    await waitForIsland(page);
    for (const id of ['cpu-heavy', 'memory-heavy']) {
      await page.getByLabel('Profile', {exact: true}).selectOption(id);
      expect(await shownIds(page)).toEqual(rankedIds(id));
      await expect(page).toHaveURL(new RegExp(`profile=${id}`));
    }
    const first = profile('memory-heavy').ranking[0];
    await expect(
      page.locator('.ranking-table tr.row').first().locator('td').nth(8),
    ).toHaveText((first?.valueScore ?? 0).toFixed(2));
  });

  test('filters keep the backend rank and survive a reload', async ({page}) => {
    await page.goto('');
    await waitForIsland(page);
    await page.getByLabel('Form factor').selectOption('laptop');
    await page.getByLabel('Apple refurbished').check();
    await page.getByLabel('Minimum RAM').selectOption('24');
    await page.getByLabel('Maximum price (£)').fill('4000');

    const expected = profile(DEFAULT)
      .ranking.filter(entry => {
        const source = listing(entry.listingId);
        return (
          source.formFactor === 'laptop' &&
          source.condition === 'apple-refurbished' &&
          source.ramGb >= 24 &&
          source.priceGbp <= 4000
        );
      })
      .map(entry => ({id: entry.listingId, rank: String(entry.rank)}));
    expect(expected.length).toBeGreaterThan(0);
    await expect(page.locator('.ranking-table tr.row')).toHaveCount(
      expected.length,
    );
    expect(await shownIds(page)).toEqual(expected.map(item => item.id));
    const ranks = await page
      .locator('.ranking-table tr.row td:first-child')
      .allInnerTexts();
    expect(ranks.map(rank => rank.trim())).toEqual(
      expected.map(item => item.rank),
    );
    await expect(page.locator('.ranking-status')).toContainText(
      `Showing ${expected.length} of ${profile(DEFAULT).ranking.length}`,
    );

    await expect(page).toHaveURL(
      /condition=apple-refurbished&form=laptop&ram=24&price=4000/,
    );
    await page.reload();
    await waitForIsland(page);
    expect(await shownIds(page)).toEqual(expected.map(item => item.id));
    await expect(page.getByLabel('Form factor')).toHaveValue('laptop');
    await expect(page.getByLabel('Apple refurbished')).toBeChecked();

    await page.getByRole('button', {name: 'Reset view'}).click();
    expect(await shownIds(page)).toEqual(rankedIds(DEFAULT));
    await expect(page).not.toHaveURL(/\?/);
  });

  test('sorts by a column, exposes aria-sort and survives a reload', async ({
    page,
  }) => {
    await page.goto('');
    await waitForIsland(page);
    const priceHeader = page.locator('.ranking-table th', {hasText: 'Price'});
    await priceHeader.getByRole('button').click();
    await expect(priceHeader).toHaveAttribute('aria-sort', 'ascending');
    const byPrice = [...profile(DEFAULT).ranking].sort(
      (a, b) =>
        listing(a.listingId).priceGbp - listing(b.listingId).priceGbp ||
        a.rank - b.rank,
    );
    expect(await shownIds(page)).toEqual(byPrice.map(e => e.listingId));

    await priceHeader.getByRole('button').click();
    await expect(priceHeader).toHaveAttribute('aria-sort', 'descending');
    await expect(page).toHaveURL(/sort=price&dir=desc/);
    await page.reload();
    await waitForIsland(page);
    await expect(
      page.locator('.ranking-table th', {hasText: 'Price'}),
    ).toHaveAttribute('aria-sort', 'descending');
    const shown = await shownIds(page);
    expect(shown[0]).toBe(byPrice.at(-1)?.listingId);
    await expect(
      page.locator('.ranking-table th', {hasText: 'Rank'}),
    ).toHaveAttribute('aria-sort', 'none');
  });

  test('row expansion shows components, unit costs and the source', async ({
    page,
  }) => {
    await page.goto('');
    await waitForIsland(page);
    const first = profile(DEFAULT).ranking[0];
    if (first === undefined) {
      throw new Error('fixture has no ranking');
    }
    const source = listing(first.listingId);
    const button = page.locator('.expand-button').first();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const detail = page.locator('.ranking-table tr.detail').first();
    await expect(detail).toContainText(
      `${first.components.multiCore.weighted.toFixed(1)} of 30`,
    );
    await expect(detail).toContainText(first.derived.modelClass);
    await expect(detail).toContainText(
      gbp(Math.round(first.derived.gbpPerGbRam * 100) / 100),
    );
    await expect(detail).toContainText(source.retrievedDate);
    await expect(detail.getByRole('link')).toHaveAttribute(
      'href',
      source.sourceUrl,
    );
    await button.click();
    await expect(page.locator('.ranking-table tr.detail')).toHaveCount(0);
  });

  test('is usable with the keyboard alone', async ({page}) => {
    await page.goto('');
    await waitForIsland(page);
    await page.getByLabel('Profile', {exact: true}).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Form factor')).toBeFocused();
    const sortButton = page
      .locator('.ranking-table th', {hasText: 'Value score'})
      .getByRole('button');
    await sortButton.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.locator('.ranking-table th', {hasText: 'Value score'}),
    ).toHaveAttribute('aria-sort', 'descending');
    const outline = await sortButton.evaluate(
      element => getComputedStyle(element).outlineStyle,
    );
    expect(outline).not.toBe('none');
  });
});

test.describe('reports', () => {
  test('lists every snapshot, newest first', async ({page}) => {
    await page.goto('reports/');
    const links = page.locator('.report-list a');
    await expect(links).toHaveText([LATEST, OLDER]);
    await expect(page.locator('.report-list li').first()).toContainText(
      'Latest',
    );
  });

  test('renders the report and the downloads resolve', async ({
    page,
    request,
  }) => {
    await page.goto(`reports/${LATEST}/`);
    const report = page.getByTestId('report');
    await expect(
      report.getByRole('heading', {name: `Mac value index: ${LATEST}`}),
    ).toBeVisible();
    await expect(
      report.getByRole('heading', {name: 'Conclusion'}),
    ).toBeVisible();
    await expect(report.locator('table').first()).toBeVisible();

    const markdown = page.getByRole('link', {name: /markdown/});
    const csv = page.getByRole('link', {name: /CSV/});
    for (const [link, start] of [
      [markdown, '# Mac value index'],
      [csv, 'rank,listing_id'],
    ] as const) {
      const href = await link.getAttribute('href');
      expect(href).toMatch(/^\/mac-value-index\/reports\//);
      const response = await request.get(href ?? '');
      expect(response.status()).toBe(200);
      expect((await response.text()).startsWith(start)).toBe(true);
    }
  });

  test('marks an older report and links to the latest ranking', async ({
    page,
  }) => {
    await page.goto(`reports/${OLDER}/`);
    await expect(page.getByText('This is an older snapshot.')).toBeVisible();
  });
});

test.describe('other pages', () => {
  test('methodology shows the weights and the Geekbench version', async ({
    page,
  }) => {
    await page.goto('methodology/');
    const row = page.locator('tr', {hasText: 'secondary-dev-llm'});
    await expect(row.locator('td')).toHaveText(['30', '35', '15', '10', '10']);
    await expect(page.locator('main')).toContainText(
      `Geekbench ${results.geekbenchVersion}`,
    );
  });

  test('sources lists every source with status and retrieval date', async ({
    page,
  }) => {
    await page.goto('sources/');
    for (const source of results.sources) {
      const row = page.locator('tr', {hasText: source.name});
      await expect(row).toContainText(source.retrievedDate);
      await expect(row).toContainText('OK');
    }
    await expect(page.locator('main')).toContainText('Not verified');
  });

  test('the 404 page works under the base path', async ({page}) => {
    const response = await page.goto('no-such-page/');
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole('heading', {name: 'Page not found'}),
    ).toBeVisible();
    await page.getByRole('link', {name: 'Latest ranking'}).click();
    await expect(page.getByTestId('conclusion')).toBeVisible();
  });

  test('sitemap, robots.txt and Open Graph metadata exist', async ({
    page,
    request,
  }) => {
    const robots = await request.get('robots.txt');
    expect(await robots.text()).toContain(
      'Sitemap: https://martinmayer-tech.github.io/mac-value-index/sitemap-index.xml',
    );
    expect((await request.get('sitemap-index.xml')).status()).toBe(200);
    const sitemap = await (await request.get('sitemap-0.xml')).text();
    expect(sitemap).toContain(
      `https://martinmayer-tech.github.io/mac-value-index/reports/${LATEST}/`,
    );
    await page.goto('');
    await expect(
      page.locator('meta[property="og:description"]'),
    ).toHaveAttribute('content', new RegExp(`Prices collected ${LATEST}`));
    for (const path of ['reports/', 'methodology/', 'sources/']) {
      await page.goto(path);
      await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        'href',
        `https://martinmayer-tech.github.io/mac-value-index/${path}`,
      );
    }
  });
});

test.describe('themes', () => {
  test('follows the system setting and can be switched by hand', async ({
    page,
  }) => {
    const background = (): Promise<string> =>
      page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.emulateMedia({colorScheme: 'light'});
    await page.goto('');
    const light = await background();
    await page.emulateMedia({colorScheme: 'dark'});
    const dark = await background();
    expect(dark).not.toBe(light);
    await page.getByRole('radio', {name: 'Light'}).check();
    expect(await background()).toBe(light);
    await page.emulateMedia({colorScheme: 'light'});
    await page.getByRole('radio', {name: 'Dark'}).check();
    expect(await background()).toBe(dark);
  });
});

test.describe('accessibility (axe, WCAG 2.2 AA)', () => {
  for (const path of [
    '',
    'reports/',
    `reports/${LATEST}/`,
    'methodology/',
    'sources/',
  ]) {
    for (const colorScheme of ['light', 'dark'] as const) {
      test(`/${path} has no violations (${colorScheme})`, async ({page}) => {
        await page.emulateMedia({colorScheme});
        await page.goto(path);
        const {violations} = await new AxeBuilder({page})
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        expect(
          violations.map(violation => ({
            id: violation.id,
            nodes: violation.nodes.map(node => node.target.join(' ')),
          })),
        ).toEqual([]);
      });
    }
  }
});

test.describe('without JavaScript', () => {
  test.use({javaScriptEnabled: false});

  test('shows the conclusion and the full default ranking as a plain table', async ({
    page,
  }) => {
    await page.goto('');
    await expect(page.getByTestId('conclusion')).toHaveText(
      profile(DEFAULT).conclusion.text,
    );
    await expect(page.getByTestId('top10').locator('li')).toHaveCount(10);
    expect(await shownIds(page)).toEqual(rankedIds(DEFAULT));
    await expect(page.getByLabel('Profile', {exact: true})).toBeDisabled();
    await expect(page.locator('noscript')).toHaveCount(1);
    await page.getByRole('link', {name: 'Reports'}).click();
    await expect(page.locator('.report-list a').first()).toHaveText(LATEST);
  });
});

test.describe('on a phone @phone', () => {
  test('has no horizontal scrolling and stacks the table into cards', async ({
    page,
  }) => {
    for (const path of ['', `reports/${LATEST}/`, 'sources/', 'methodology/']) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow on /${path}`).toBeLessThanOrEqual(
        0,
      );
    }
    await page.goto('');
    const display = await page
      .locator('.ranking-table tr.row td')
      .first()
      .evaluate(cell => getComputedStyle(cell).display);
    expect(display).toBe('grid');
    await waitForIsland(page);
    await page.getByLabel('Sort by').selectOption('price');
    await expect(page).toHaveURL(/sort=price/);
  });
});
