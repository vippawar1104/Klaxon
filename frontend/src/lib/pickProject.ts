/**
 * Which project the dashboard should be showing, given the projects the
 * signed-in account actually owns and the id it currently has selected.
 *
 * The selected id lives in App state, which survives signing out and signing
 * in as someone else without a page refresh. The sidebar used to choose a
 * project only when nothing was selected, so a leftover id from the PREVIOUS
 * account was kept: the dropdown still displayed the first project (it falls
 * back to it for display), but every pane went looking for a project this
 * account doesn't own — the Setup page sat on "Loading…" forever, the issue
 * list 404'd. A selection is only kept if it's really in the list.
 */
export function pickProjectId(
  projects: { id: number }[],
  current: number | null,
): number | null {
  if (current !== null && projects.some((p) => p.id === current)) return current
  return projects.length > 0 ? projects[0].id : null
}
