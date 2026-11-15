# Backend

The research and calculation pipeline. It is a CLI that runs locally and in
GitHub Actions; there is no hosted service.

```mermaid
flowchart LR
    A[collect] --> B[normalise]
    B --> C[validate]
    C --> D[score]
    D --> E[report]
    E --> F[diff]
```

## Layout

```
src/
├── cli/            # argument parsing and stage wiring only
├── collect/
│   ├── adapters/   # one file per source
│   ├── http.ts     # fetch wrapper: robots.txt, rate limit, retry, cache
│   ├── normalise.ts
│   └── guards.ts   # anomaly guards
├── scoring/        # pure functions: no I/O, no clock, no randomness
├── report/         # markdown and CSV rendering
├── diff/
└── io/             # all file reads and writes
```

`scoring/` is kept pure by an ESLint rule that bans Node.js APIs, `Date`,
`fetch` and `Math.random` there. The snapshot date comes from the data.

## Dependencies

| Package          | Why                                                         |
| ---------------- | ----------------------------------------------------------- |
| `@mvi/contracts` | The shared schemas. Everything read or written is validated |
| `zod`            | Validates raw adapter output before it is normalised        |
| `cheerio`        | Finds JSON-LD script blocks in fetched HTML                 |
| `yaml`           | Reads the profiles                                          |
| `fast-check`     | Property-based tests (development only)                     |

HTTP uses the native `fetch`; the CLI uses `node:util` `parseArgs`.

## Collection rules

- `robots.txt` is read for every host and obeyed. A disallowed URL fails
  that adapter with a clear message; it is reported, not worked around.
- One request per second per host, three attempts with backoff, and a
  descriptive user agent.
- Raw responses are cached in `.cache/<date>/` so a re-run does not
  re-fetch. The cache is not committed.
- A failing adapter never fails the run. Its failure is recorded in the
  snapshot's `sourceStatus`.
- Nothing is invented or estimated. A listing that cannot be read is
  dropped with a warning.

Behind an HTTPS proxy, set `NODE_USE_ENV_PROXY=1` so that Node's `fetch`
honours `HTTPS_PROXY`.

## Adding a source adapter

1. Check the site's `robots.txt` and terms of use. If automated access is
   not allowed, stop and record that instead.
2. Create `src/collect/adapters/<source-id>.ts` exporting a `SourceAdapter`:

   ```ts
   export const exampleShop: SourceAdapter = {
     id: 'example-shop',
     kind: 'structured', // or 'agent'
     condition: 'third-party-refurbished',
     name: 'Example Shop',
     url: 'https://www.example.com/refurbished-macs',
     async collect(context) {
       const page = await context.http.get(this.url);
       return parsePage(page.body, context.retrievedDate, context.warn);
     },
   };
   ```

   Always fetch through `context.http`. Prefer machine-readable data in the
   page (schema.org JSON-LD) over visible markup. Return `RawListing`
   objects; they are validated by `rawListingSchema`.

3. Keep parsing in an exported pure function and test it against a page
   recorded under `test/fixtures/`. Tests must not touch the network.
4. Add the adapter to `ADAPTERS` in `src/collect/adapters/index.ts`.
5. If the source sells a chip variant that is not in `data/chips.json`, add
   it there first (with sources), or collection fails validation.

An agent adapter (`kind: 'agent'`) must return a source URL for every
listing, set `collectedBy: 'agent'`, read its API key from an environment
variable and throw `AdapterSkippedError` when the key is absent. Check the
provider's current documentation for SDK, model and tool names.

## Adding a profile

1. Copy a file in `profiles/` to `profiles/<id>.yaml`. The `id` must match
   the file name.
2. Set the weights (they must sum to 100), reservations, floors, model
   classes and price bands. Exactly one profile has `isDefault: true`.
3. Run `pnpm backend validate`, then `pnpm backend score` and
   `pnpm backend report`, and commit the regenerated `results/`.

The site's profile switcher lists whatever profiles are in `results.json`.

## Scoring in brief

- Memory headroom = RAM minus the reservation. Usable storage = SSD minus
  the reservation.
- Each metric is divided by the best value among the listings ranked under
  the profile (zero to one).
- Capability score (zero to 100) = sum of normalised metric × weight.
- Value score = capability score ÷ price × 1,000. Ties break on higher
  capability, then lower price, then listing id.
- A listing below a floor, or whose chip lacks a verified figure for a
  weighted metric, is excluded with the reason.

## Tests

- Unit and property-based tests for every scoring function.
- Adapter tests against recorded fixtures.
- A golden-file test in `src/scoring/golden.test.ts`. After a deliberate
  change, regenerate with `UPDATE_GOLDEN=1 pnpm test` and review the diff.
