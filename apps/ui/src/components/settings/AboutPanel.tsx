/** The development build's version: what a program built without the release stamp reports (apps/desktop/version.go). */
const DEVELOPMENT_VERSION = '0.0.0-dev';

/** A build with no release stamp reports this version, or none (apps/desktop/version.go; the host's `update.IsDevelopment`). */
function isDevelopmentBuild(version: string): boolean {
  return version === '' || version === DEVELOPMENT_VERSION;
}

/** What the narrator is running: the product name and its version, from `Bootstrap`. */
export function AboutPanel({ version }: { version: string }) {
  return (
    <div className="mb-4 space-y-3 text-sm">
      <div className="rounded-md p-3" style={{ background: 'var(--surface-2)' }}>
        <div className="font-medium">Narration Utils</div>
        <div>Version {version}</div>
        {isDevelopmentBuild(version) && (
          <p className="mt-1" style={{ color: 'var(--text-muted)' }}>
            This is a development build, not a release, so it has no version to compare with a newer one.
          </p>
        )}
      </div>
      <p style={{ color: 'var(--text-muted)' }}>Narration Utils is free software, licensed under the GNU Affero General Public License, version 3 or later.</p>
    </div>
  );
}
