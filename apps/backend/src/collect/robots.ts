// Minimal robots.txt evaluation (RFC 9309): group selection by user-agent
// token, Allow and Disallow rules with * and $, longest match wins.

interface Rule {
  readonly allow: boolean;
  readonly pattern: string;
}

interface Group {
  readonly agents: string[];
  readonly rules: Rule[];
}

function parseGroups(robotsTxt: string): readonly Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const separator = line.indexOf(':');
    if (separator < 0) {
      continue;
    }
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === 'user-agent') {
      if (current === null || !lastWasAgent) {
        current = {agents: [], rules: []};
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === 'allow' || field === 'disallow') {
      lastWasAgent = false;
      if (current !== null && value !== '') {
        current.rules.push({allow: field === 'allow', pattern: value});
      }
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*')
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** True when the rules for this agent (or *) allow fetching the URL. */
export function isAllowedByRobots(
  robotsTxt: string,
  agentToken: string,
  url: URL,
): boolean {
  const groups = parseGroups(robotsTxt);
  const token = agentToken.toLowerCase();
  const specific = groups.filter(group =>
    group.agents.some(agent => agent !== '*' && token.includes(agent)),
  );
  const selected =
    specific.length > 0
      ? specific
      : groups.filter(group => group.agents.includes('*'));
  const target = `${url.pathname}${url.search}`;
  let decision = true;
  let longest = -1;
  for (const rule of selected.flatMap(group => group.rules)) {
    if (!patternToRegExp(rule.pattern).test(target)) {
      continue;
    }
    const length = rule.pattern.length;
    if (length > longest || (length === longest && rule.allow)) {
      longest = length;
      decision = rule.allow;
    }
  }
  return decision;
}
