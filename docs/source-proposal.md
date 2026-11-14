# Proposal: third-party sources and benchmark data

Status: **awaiting approval**. Nothing in this document is built.

The specification asks for the list of third-party sources and the adapter
kind for each to be proposed and approved before any are built. It also
asks to be consulted before any assumption that changes the ranking.

## What is collected today

| Source                         | Kind       | Condition         | Status |
| ------------------------------ | ---------- | ----------------- | ------ |
| Apple UK Store                 | structured | new               | built  |
| Apple UK Certified Refurbished | structured | apple-refurbished | built  |

## Proposed third-party sources

None of these sites has been fetched: the build environment's network
policy allows only the Apple and Geekbench hosts. For each one, the first
step is to read its `robots.txt` and terms of use. A source that disallows
automated access is dropped and reported.

Refurbishers (graded stock, 12-month warranty minimum, back to M1 Max and
M1 Ultra):

| Source            | Proposed kind                                 | To confirm                             |
| ----------------- | --------------------------------------------- | -------------------------------------- |
| Hoxton Macs       | structured, if product pages carry JSON-LD    | robots.txt, terms, warranty length     |
| MResell UK        | structured, if product pages carry JSON-LD    | robots.txt, terms, warranty length     |
| Back Market UK    | agent (marketplace, many sellers per listing) | robots.txt, terms, per-seller warranty |
| Amazon Renewed UK | agent, if permitted                           | robots.txt, terms (likely to disallow) |

Retailers, for the best current price of new machines (recorded separately
from Apple's price):

| Source     | Proposed kind                              | To confirm        |
| ---------- | ------------------------------------------ | ----------------- |
| John Lewis | structured, if product pages carry JSON-LD | robots.txt, terms |
| Currys     | structured, if product pages carry JSON-LD | robots.txt, terms |
| KRCS       | structured, if product pages carry JSON-LD | robots.txt, terms |
| Costco UK  | agent                                      | robots.txt, terms |

Decisions needed:

1. Which of these to pursue.
2. Approval to add each chosen host to the environment's network allowlist.
3. Whether agent adapters are wanted at all. They need an API key stored as
   a repository secret and cost money per run.

## Benchmark data

Geekbench's site blocks automated access and its `robots.txt` excludes AI
agents, so it is not collected from. The current `data/chips.json` was
filled by a research agent from search-result snippets of secondary
sources. Every record is flagged `collectedBy: agent`.

Open points, each of which changes the ranking:

1. **Verification.** Each figure needs checking against its linked page.
2. **Mixed sources.** Most CPU and Metal figures are Notebookcheck averages
   of its own test units; some are EveryMac averages of user submissions or
   a single Tom's Guide review run. Choosing one source family would be
   more consistent.
3. **Missing Metal scores.** No citable Geekbench 6 Metal score was found
   for M4 (8/8), M5 Pro (15/16), M5 Max (18/32), M5 Ultra (30/64 and
   36/80) or M6 (10/10); M6 (10/10) also lacks a memory bandwidth figure.
   Those listings are excluded from the ranking rather than estimated.
   Options: enter the figures by hand from Geekbench's Mac benchmark chart;
   or move to Geekbench 7, which most outlets now use for the newest chips,
   for every chip at once.
4. **M6 (12/12) Metal score.** The recorded figure (101,981) is contested:
   other outlets report roughly 87,000 to 91,000.

## Assumptions made so far that affect the ranking

- "GPU and bandwidth" is half normalised Metal score, half normalised
  memory bandwidth (`gpuAndBandwidthSplit` in each profile).
- A listing is excluded, not scored at zero, when a weighted metric has no
  verified figure.
- 1 TB is counted as 1,000 GB.
- Colour and display-finish variants are collapsed to the cheapest.
- The external SSD for the storage sensitivity is priced from the Apple UK
  store (SanDisk Professional PRO-G40 2TB, £699.95), the only allowed
  source. Other retailers are likely to be cheaper.
- Model-class thresholds are in each profile, with their assumptions.
