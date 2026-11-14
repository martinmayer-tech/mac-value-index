import type {APIRoute} from 'astro';

import {withBase} from '../lib/paths.js';

export const GET: APIRoute = ({site}) =>
  new Response(
    [
      'User-agent: *',
      'Allow: /',
      '',
      `Sitemap: ${new URL(withBase('sitemap-index.xml'), site).href}`,
      '',
    ].join('\n'),
    {headers: {'content-type': 'text/plain; charset=utf-8'}},
  );
