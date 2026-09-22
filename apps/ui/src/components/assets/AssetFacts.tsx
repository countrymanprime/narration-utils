import type { AssetInstallJob } from '../../types';

const BYTES_PER_MB = 1024 * 1024;
const BYTES_PER_GB = 1024 * BYTES_PER_MB;

/** A size a narrator can read: whole megabytes below a gigabyte, one decimal of a gigabyte above. */
export function formatSize(bytes: number): string {
  if (bytes >= BYTES_PER_GB) return `${(bytes / BYTES_PER_GB).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / BYTES_PER_MB))} MB`;
}

/** While it downloads, the real bytes so far ("44 of 109 MB"), so the narrator sees it move and knows how far it has to go; nothing before the size is known. */
export function bytesProgress(job: Pick<AssetInstallJob, 'phase' | 'bytesDone' | 'bytesTotal'>): string | undefined {
  if (job.phase !== 'downloading' || job.bytesTotal <= 0) return undefined;
  return `${Math.round(job.bytesDone / BYTES_PER_MB)} of ${Math.round(job.bytesTotal / BYTES_PER_MB)} MB`;
}

export type AssetFactsProps = {
  /** What the asset is called in this dialog: "Voice", "Model", "Language model". */
  label: string;
  name: string;
  version: string;
  publisher: string;
  license: string;
  licenseUrl: string;
  modelCardUrl: string;
  provenanceUrl: string;
  downloadSize: number;
  /** What it takes on the disk once installed; the same as the download unless it is unpacked. */
  diskSize: number;
  /** Where it will be stored. */
  installPath: string;
};

/**
 * What the first-use question says about a download, the same for every kind of asset (the first-use rules): what it is and its exact
 * version, who publishes it, how much is downloaded and how much disk it needs, where it will be kept, and its licence and provenance
 * links. A definition list holds only term and definition groups; the links follow it.
 */
export function AssetFacts({
  label,
  name,
  version,
  publisher,
  license,
  licenseUrl,
  modelCardUrl,
  provenanceUrl,
  downloadSize,
  diskSize,
  installPath,
}: AssetFactsProps) {
  const rows: Array<[string, string]> = [
    [label, name],
    ['Version', version],
    ['Download', `${formatSize(downloadSize)} · ${publisher}`],
    ['Disk needed', formatSize(diskSize)],
    ['Saved to', installPath],
  ];
  return (
    <>
      <dl className="mt-3 space-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        {rows.map(([term, definition]) => (
          <div key={term}>
            <dt className="inline font-medium">{term}: </dt>
            <dd className="inline break-all">{definition}</dd>
          </div>
        ))}
        <div>
          <dt className="inline font-medium">License: </dt>
          <dd className="inline">
            <a className="link" href={licenseUrl} target="_blank" rel="noreferrer">
              {license}
            </a>
          </dd>
        </div>
      </dl>
      <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        <a className="link" href={modelCardUrl} target="_blank" rel="noreferrer">
          Model card
        </a>
        {' · '}
        <a className="link" href={provenanceUrl} target="_blank" rel="noreferrer">
          Provenance
        </a>
      </p>
    </>
  );
}
