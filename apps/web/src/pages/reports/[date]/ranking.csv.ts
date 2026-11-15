import type {APIRoute, GetStaticPaths} from 'astro';

import {getSnapshots} from '../../../lib/snapshots.js';

export const getStaticPaths: GetStaticPaths = async () =>
  (await getSnapshots()).map(snapshot => ({
    params: {date: snapshot.data.date},
    props: {body: snapshot.data.rankingCsv},
  }));

export const GET: APIRoute = ({props}) =>
  new Response(String(props['body']), {
    headers: {'content-type': 'text/csv; charset=utf-8'},
  });
