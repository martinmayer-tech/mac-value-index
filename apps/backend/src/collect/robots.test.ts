import {describe, expect, it} from 'vitest';

import {isAllowedByRobots} from './robots.js';

const ROBOTS = `
# comment
User-agent: *
Disallow: /*shop/browse/overlay/*
Disallow: /private/
Allow: /private/open/
Disallow: /*.pdf$
Sitemap: https://example.com/sitemap.xml

User-agent: BadBot
User-agent: OtherBot
Disallow: /

User-agent: mac-value-index
Disallow: /only-us/
`;

function allowed(path: string, agent = 'some-crawler'): boolean {
  return isAllowedByRobots(
    ROBOTS,
    agent,
    new URL(`https://example.com${path}`),
  );
}

describe('isAllowedByRobots', () => {
  it('allows paths with no matching rule', () => {
    expect(allowed('/uk/shop/refurbished/mac')).toBe(true);
  });

  it('applies wildcard and end-anchored rules', () => {
    expect(allowed('/uk/shop/browse/overlay/mac')).toBe(false);
    expect(allowed('/files/a.pdf')).toBe(false);
    expect(allowed('/files/a.pdf?x=1')).toBe(true);
  });

  it('lets the longest match win', () => {
    expect(allowed('/private/secret')).toBe(false);
    expect(allowed('/private/open/page')).toBe(true);
  });

  it('prefers a group that names the agent', () => {
    expect(allowed('/anything', 'BadBot/1.0')).toBe(false);
    expect(allowed('/anything', 'otherbot')).toBe(false);
    expect(allowed('/private/secret', 'mac-value-index')).toBe(true);
    expect(allowed('/only-us/x', 'mac-value-index')).toBe(false);
  });

  it('allows everything when there are no rules', () => {
    expect(isAllowedByRobots('', 'x', new URL('https://example.com/a'))).toBe(
      true,
    );
    expect(
      isAllowedByRobots(
        'Disallow: /orphan\nUser-agent: *\nDisallow:\nnonsense line',
        'x',
        new URL('https://example.com/orphan'),
      ),
    ).toBe(true);
  });
});
