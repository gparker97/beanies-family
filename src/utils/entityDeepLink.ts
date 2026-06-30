/**
 * Entity → in-app deep link (path + query). Extracted verbatim from
 * `GlobalSearch.selectResult` so global search AND notification "Open" share one
 * map — the target pages honour these query params (`?view=`/`?activity=`/
 * `?edit=`). Adding a new linkable entity is a single switch case here.
 */
export type DeepLinkType =
  'activity' | 'vacation' | 'todo' | 'account' | 'transaction' | 'goal' | 'asset' | 'member';

export interface DeepLink {
  path: string;
  query: Record<string, string>;
}

export function entityDeepLink(type: DeepLinkType, id: string): DeepLink {
  switch (type) {
    case 'activity':
      return { path: '/activities', query: { activity: id } };
    case 'vacation':
      return { path: '/travel', query: { vacation: id } };
    case 'todo':
      return { path: '/todo', query: { view: id } };
    case 'account':
      return { path: '/accounts', query: { view: id } };
    case 'transaction':
      return { path: '/transactions', query: { view: id } };
    case 'goal':
      return { path: '/goals', query: { view: id } };
    case 'asset':
      return { path: '/assets', query: { view: id } };
    case 'member':
      return { path: '/family', query: { edit: id } };
  }
}
