# mac-value-index: frontend component

The frontend is a static Astro site that presents the backend's
pre-calculated results. Read `mac-value-index-system-overview.md` first
for the architecture, contract, shared standards and CI/CD.

## Responsibilities

In scope:

- Present the conclusion, top 10, chart, full ranking and reports.
- Let the reader switch between pre-calculated profiles, and sort and
  filter the ranking table.
- Show where every figure came from and when it was collected.
- Offer the markdown report and CSV as downloads.

Out of scope, with no exceptions:

- No scoring, weighting, normalising or ranking logic. If a number is
  not in `results.json`, ask for it to be added to the backend.
- No price or benchmark data stored in the web app.
- No network requests at runtime. No API calls, analytics beacons or
  third-party fonts and scripts.
- No imports from `apps/backend`.

Permitted in the browser, as presentation only: sorting by a column,
filtering rows by fields already in the results, switching profile, and
formatting numbers.

## Stack

- Astro with static output, in `apps/web`.
- TypeScript, extending the shared base and `astro/tsconfigs/strictest`.
- One Preact island for the ranking table. Everything else is static
  HTML with zero client JavaScript.
- Observable Plot for the chart, rendered to SVG at build time.
- zod schemas and types imported from `packages/contracts`.
- Plain CSS with custom properties. No CSS framework.
- vitest for unit tests. Playwright for a small end-to-end suite.

## Data loading

- Read `results/index.json`, then every `results/YYYY-MM-DD/results.json`
  and `report.md`, at build time through Astro content collections with a
  custom loader.
- Validate every file with the contract schemas. A failed validation
  fails the build with the file name and the failing field.
- Check `schemaVersion`. An unsupported version fails the build.
- The ranking island receives its data as serialised props for the
  latest snapshot only. Keep the payload small: send only the fields the
  table displays.

## Pages

| Route | Content |
|---|---|
| `/` | Conclusion, top 10, chart, interactive ranking, snapshot date |
| `/reports/` | List of all snapshots, newest first |
| `/reports/YYYY-MM-DD/` | That snapshot's report rendered from `report.md`, with download links |
| `/methodology/` | Formulas, profiles and weights, reservations, Geekbench version, caveats |
| `/sources/` | Every source for the latest snapshot, with retrieval dates and status |
| `/404` | Not-found page that works under the project base path |

### Home page, in this order

1. **Conclusion**: the backend's conclusion text for the default
   profile, and the winning configuration with its price.
2. **Snapshot date**, with a link to sources. If the snapshot is more
   than 14 days old at build time, show a visible "prices may be out of
   date" notice.
3. **Top 10**: a card or row per entry with rank, model, chip, RAM, SSD,
   condition, price, value score and the backend's plain-English summary
   line. Each links to its source listing.
4. **Chart**: price against capability score. Pareto frontier
   highlighted, top 10 labelled, conditions distinguished by both shape
   and colour.
5. **Best pick per price band.**
6. **Interactive ranking table** (the island).
7. **New versus refurbished** summary.
8. Link to the full report and methodology.

### Ranking table (Preact island)

- Profile switcher: `secondary-dev-llm`, `cpu-heavy`, `memory-heavy`.
  Switching shows that profile's pre-calculated ranking. It does not
  recalculate anything.
- Filters: condition, form factor, minimum RAM, minimum SSD, maximum
  price, chip family.
- Sort by any column. Default is rank for the selected profile.
- Rank shown is always the backend's rank for that profile, even when
  filtered, so filtering never implies a new ranking.
- Indicators for: Pareto frontier, stable across all profiles, collected
  by agent.
- Row expansion: score components, unit costs, model class, warranty,
  source link and retrieved date.
- Current profile, filters and sort are stored in the URL query string,
  so a view can be shared and survives a reload.
- Without JavaScript, the page shows the full default-profile ranking as
  a plain static table.

## Design requirements

- Reads well on a phone. The table becomes stacked cards on narrow
  screens; no horizontal scrolling of the page.
- Light and dark themes following the system setting, with a manual
  toggle.
- System font stack. No web fonts.
- Prices formatted as GBP with thousands separators. Dates as
  YYYY-MM-DD.
- British English throughout.
- Restrained, data-first design. The conclusion and top 10 must be
  visible without scrolling on a laptop screen.
- A print stylesheet for the report pages.

## Accessibility

- WCAG 2.2 AA.
- Semantic tables with proper headers and captions. Sort state exposed
  with `aria-sort`.
- All controls usable by keyboard, with visible focus.
- The chart has a text alternative and an equivalent data table.
- Meaning is never carried by colour alone.
- Respects `prefers-reduced-motion`.

## GitHub Pages specifics

- `site` and `base` set in the Astro config for a project site at
  `/mac-value-index/`. Every internal link and asset uses the base path.
  Add a lint rule or test that fails on a root-relative link.
- `trailingSlash` set consistently and matched in all links.
- Generate `sitemap.xml` and `robots.txt`.
- Open Graph metadata on every page, including the snapshot date in the
  home page description.

## Performance budget

- Lighthouse performance, accessibility, best practices and SEO all at
  90 or above.
- Client JavaScript on the home page under 50 KB compressed.
- No layout shift from the island: reserve its space in the static HTML.
- Chart rendered at build time, not in the browser.

## Testing

- Unit tests (vitest) for formatting helpers, filter and sort functions,
  and URL query-string encoding and decoding.
- A test that fails if any file in `apps/web` imports from
  `apps/backend` or contains scoring logic (enforced mainly by the ESLint
  boundary rule).
- End-to-end tests (Playwright) against the built site, served under the
  `/mac-value-index/` base path:
  - home page shows the conclusion and ten entries;
  - profile switch changes the order to match `results.json`;
  - filters and sort work, and survive a reload through the URL;
  - report page renders and download links resolve;
  - the page is usable with JavaScript disabled.
- Build against a small fixture results set in tests, so the tests do
  not depend on live data.

## CI/CD touchpoints

Defined in full in the system overview. The frontend must support them:

- `pnpm --filter web build` fails on any schema or version mismatch.
- `astro check` passes with zero errors and zero warnings.
- The built site passes the link check, HTML validation, axe and
  Lighthouse CI budgets.
- The built site is uploaded as an artifact on pull requests.
- The deployed site exposes the snapshot date in a stable, testable
  place (for example a `data-snapshot-date` attribute) for the
  post-deploy smoke test.

## Definition of done

- The site builds from committed results with no network access.
- Every figure on the site matches `results.json` exactly, apart from
  display rounding.
- All tests and site checks pass.
- The site works at `/mac-value-index/` on GitHub Pages, on a phone,
  with a keyboard, and with JavaScript disabled.
