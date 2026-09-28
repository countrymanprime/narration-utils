import { Navigate, useLocation, useParams, type Params } from 'react-router-dom';

/**
 * A retired route's redirect (stage-navigation-and-page-replacement.prd.md, "Redirects"; ADR 0407): replaces the old
 * address with the new one, keeping its query and hash so a deep link (a finding, a word's time, an anchor) still
 * lands where it pointed. `to` may map the old route's params (`/tracks/chapter/:chapterId` to `/proof/:chapterId`).
 * It replaces rather than pushes, so Back never lands on the old address and bounces forward again.
 */
export function RedirectKeepingLocation({ to }: { to: string | ((params: Readonly<Params>) => string) }) {
  const location = useLocation();
  const params = useParams();
  const path = typeof to === 'function' ? to(params) : to;
  return <Navigate to={`${path}${location.search}${location.hash}`} replace />;
}
