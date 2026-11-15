// Every internal link and asset goes through withBase, so the site works
// under the GitHub Pages project path.

/** Joins a site-relative path onto the base path. */
export function joinBase(base: string, path: string): string {
  const trimmedBase = base.replace(/\/+$/, '');
  const trimmedPath = path.replace(/^\/+/, '');
  return `${trimmedBase}/${trimmedPath}`;
}

/** Path under the configured base, for example "reports/" to "/mac-value-index/reports/". */
export function withBase(path: string): string {
  return joinBase(import.meta.env.BASE_URL, path);
}
