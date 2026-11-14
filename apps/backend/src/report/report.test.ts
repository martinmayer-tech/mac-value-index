import {sampleListing, sampleSnapshot} from '@mvi/contracts';
import {describe, expect, it} from 'vitest';

import {renderDiff} from '../diff/diff.js';
import {buildResults} from '../scoring/build-results.js';
import {
  CHIPS_FILE,
  IDS,
  LISTINGS,
  PROFILES,
  SNAPSHOT,
} from '../scoring/test-data.js';

import {renderCsv} from './csv.js';
import {renderReport} from './markdown.js';

const results = buildResults(SNAPSHOT, CHIPS_FILE, PROFILES);

describe('renderReport', () => {
  const report = renderReport(results);

  it('has every section, in order, with the conclusion first', () => {
    const headings = report
      .split('\n')
      .filter(line => line.startsWith('## '))
      .map(line => line.slice(3));
    expect(headings).toEqual([
      'Conclusion',
      'Top 10',
      'In plain English',
      'Best pick per price band',
      'New versus refurbished',
      'Sensitivity and stability',
      'Methodology',
      'Caveats',
      'Sources',
      'Appendix: full ranking',
      'Appendix: exclusions',
    ]);
    expect(report.startsWith('# Mac value index: 2026-01-05\n')).toBe(true);
  });

  it('shows the top 10 with formatted figures and source links', () => {
    expect(report).toContain(
      '| 1 | [Mac mini](https://example.com/listing) | M4 (10-core CPU, 10-core GPU) | 16GB | 512GB | new | £799 | 14,978 | 4 GB (below 7B) | 362 GB |',
    );
    expect(report).toContain(
      '1. Mac mini M4 10/10-core 16GB 512GB (new) is £799',
    );
  });

  it('flags agent-collected data for a human check', () => {
    expect(report).toContain(
      '> **Needs a human check**: 1 chip benchmark records and 1 listings were collected by a research agent',
    );
  });

  it('reports failed sources, exclusions and the methodology', () => {
    expect(report).toContain(
      'Sources that failed or were skipped: Example Refurb.',
    );
    expect(report).toContain('8 GB RAM is below the 16 GB floor.');
    expect(report).toContain('Geekbench 6 single-core, multi-core and Metal');
    expect(report).toContain(
      '| `secondary-dev-llm` (default) | 30 | 35 | 15 | 10 | 10 |',
    );
    expect(report).toContain('Saving %');
    expect(report).toContain('-£100');
  });

  it('copes with a snapshot that has nothing to compare or exclude', () => {
    const plain = renderReport(
      buildResults(sampleSnapshot([sampleListing()]), CHIPS_FILE, PROFILES),
    );
    expect(plain).toContain(
      'No configuration in this snapshot is available both new and refurbished.',
    );
    expect(plain).toContain('No listing was excluded.');
    expect(plain).toContain('No source failed or was skipped.');
    expect(plain).not.toContain('Needs a human check');
  });

  it('shows an empty band and rejects results without the default profile', () => {
    const empty = renderReport(
      buildResults(
        sampleSnapshot([sampleListing({ramGb: 8})]),
        CHIPS_FILE,
        PROFILES,
      ),
    );
    expect(empty).toContain('| Under £1,000 | No listing in this band |');
    expect(() =>
      renderReport({...results, defaultProfileId: 'missing'}),
    ).toThrow(/Default profile missing/);
    expect(() => renderCsv({...results, defaultProfileId: 'missing'})).toThrow(
      /Default profile missing/,
    );
  });
});

describe('renderCsv', () => {
  it('has a header and one unformatted row per ranked listing', () => {
    const lines = renderCsv(results).trimEnd().split('\n');
    expect(lines).toHaveLength(6);
    expect(lines[0]?.split(',')).toHaveLength(31);
    expect(lines[1]).toMatch(
      new RegExp(
        `^1,${IDS.miniBase},Mac mini,2024,desktop,M4,10,10,16,512,new,Apple UK,799,14978,`,
      ),
    );
  });

  it('quotes cells that contain commas or quotes', () => {
    const quoted = renderCsv(
      buildResults(
        sampleSnapshot([sampleListing({seller: 'Shop, "Best" Ltd'})]),
        CHIPS_FILE,
        PROFILES,
      ),
    );
    expect(quoted).toContain(',"Shop, ""Best"" Ltd",');
  });
});

describe('renderDiff', () => {
  const next = sampleSnapshot(
    [
      ...LISTINGS.filter(
        l => l.id !== IDS.miniBase && l.id !== IDS.miniLowRam,
      ).map(l =>
        l.id === IDS.miniProRefurbished
          ? {...l, priceGbp: 1499}
          : l.id === IDS.macbookMax
            ? {...l, priceGbp: 5299.5}
            : l,
      ),
      sampleListing({id: '00000000000000d1', ramGb: 64, priceGbp: 2399}),
    ],
    {snapshotDate: '2026-01-12', sourceStatus: SNAPSHOT.sourceStatus},
  );
  const nextResults = buildResults(next, CHIPS_FILE, PROFILES);
  const diff = renderDiff({
    fromSnapshot: SNAPSHOT,
    toSnapshot: next,
    fromResults: results,
    toResults: nextResults,
  });

  it('states a change of winner at the top', () => {
    expect(
      diff.markdown.startsWith('> **The overall winner changed**: from'),
    ).toBe(true);
    expect(diff.hasChanges).toBe(true);
  });

  it('lists additions, removals and price changes, largest first', () => {
    expect(diff.markdown).toContain(
      '9 listings before, 8 after: 1 added, 2 removed, 2 price changes.',
    );
    expect(diff.markdown).toContain('### Listings added (1)');
    expect(diff.markdown).toContain('64GB 1TB (new, Apple UK): £2,399');
    expect(diff.markdown).toContain('16GB 512GB (new, Apple UK): was £799');
    const changes = diff.markdown.split('### Price changes')[1] ?? '';
    expect(changes.indexOf('£1,699 to £1,499 (-£200, -11.8%)')).toBeGreaterThan(
      0,
    );
    expect(changes.indexOf('£1,699 to £1,499')).toBeLessThan(
      changes.indexOf('£5,199.50 to £5,299.50 (+£100, +1.9%)'),
    );
  });

  it('describes movement in the top 10, failed sources and agent listings', () => {
    expect(diff.markdown).toMatch(/- New at \d+: .*64GB 1TB/);
    expect(diff.markdown).toMatch(/- Dropped out \(was 1\): /);
    expect(diff.markdown).toMatch(/- \d+ to \d+: /);
    expect(diff.markdown).toContain(
      '- Example Refurb (`example-refurb`): failed. HTTP 503',
    );
    expect(diff.markdown).toContain(
      '### Agent-collected listings that need a human check (1)',
    );
    expect(diff.markdown).toContain(
      '(third-party refurbished, Example Refurb): £2,099, https://example.com/listing',
    );
  });

  it('reports no changes between identical snapshots', () => {
    const same = renderDiff({
      fromSnapshot: SNAPSHOT,
      toSnapshot: SNAPSHOT,
      fromResults: results,
      toResults: results,
    });
    expect(same.hasChanges).toBe(false);
    expect(same.markdown).toContain('No movement.');
    expect(same.markdown).not.toContain('winner changed');
  });

  it('handles snapshots with nothing ranked', () => {
    const none = sampleSnapshot([sampleListing({ramGb: 8})], {
      sourceStatus: [],
    });
    const noneResults = buildResults(none, CHIPS_FILE, PROFILES);
    const toNothing = renderDiff({
      fromSnapshot: SNAPSHOT,
      toSnapshot: none,
      fromResults: results,
      toResults: noneResults,
    });
    expect(toNothing.markdown).toContain('to none.');
    const fromNothing = renderDiff({
      fromSnapshot: none,
      toSnapshot: SNAPSHOT,
      fromResults: noneResults,
      toResults: results,
    });
    expect(fromNothing.markdown).toContain('from none to');
    expect(fromNothing.markdown).toContain(
      '### Sources that failed or were skipped',
    );
  });
});
