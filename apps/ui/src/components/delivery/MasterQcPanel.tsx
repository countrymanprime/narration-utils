import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import type { DeliveryProfilesState, ExportItem, ExportJob, PackageItem, PackageItemKind, PackageJob } from '../../types';
import { Button } from '../primitives/Button';
import { Checkbox } from '../primitives/Checkbox';
import { Panel } from '../primitives/Panel';
import { ProgressBar } from '../primitives/ProgressBar';
import { Select } from '../primitives/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import { TextField } from '../primitives/TextField';
import { deliveryProfileKey, deliveryProfileTitle } from './deliveryProfile';

/** How often a running export or package job is read. */
const POLL_MS = 500;

const MUTED = { color: 'var(--text-muted)' };
const DANGER = { color: 'var(--danger-text)' };
const OK = { color: 'var(--ok-text)' };

const KIND_OPTIONS: { value: PackageItemKind; label: string }[] = [
  { value: 'chapter', label: 'Chapter' },
  { value: 'credits_opening', label: 'Opening credits' },
  { value: 'credits_closing', label: 'Closing credits' },
  { value: 'retail_sample', label: 'Retail sample' },
];

/** The file name, with its extension, for display and labels. */
const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

/** The file name without its extension, seeded as a chapter's default title. */
const titleFromPath = (path: string): string => fileName(path).replace(/\.[^.]+$/, '');

/** A row's editable status label ("Waiting", "Mastering…", "Encoded", "Failed: …", "Cancelled"). */
function exportRowStatus(file: ExportJob['files'][number]): string {
  switch (file.status) {
    case 'pending':
      return 'Waiting';
    case 'mastering':
      return 'Mastering…';
    case 'encoding':
      return 'Encoding…';
    case 'done':
      return 'Ready';
    case 'failed':
      return `Failed: ${file.error ?? 'unknown reason'}`;
    case 'cancelled':
      return 'Cancelled';
  }
}

/**
 * Master & QC (render-encode-master.prd.md Phase 5, extending the Delivery page rather than a new page/nav entry:
 * Phase 5's Parallel-session row lists only `apps/ui/src/components/delivery/*`, and "Delivery Platform Profiles'
 * own UI phases (same page)" as its collision, so this ships as a tab of the existing page, not a serial-point nav
 * change). The narrator picks rendered files, assigns each a role and (for a chapter) a title, optionally masters
 * them (internal/mastering, Phase 3), encodes them (internal/encodeport, Phases 1-2) and assembles one delivery
 * profile's package (internal/packager, Phase 4). Nothing here changes a source file: every stage writes a new one.
 */
export function MasterQcPanel() {
  const api = useApi();
  const [picking, setPicking] = useState(false);
  const [items, setItems] = useState<ExportItem[]>([]);
  const [master, setMaster] = useState(false);
  const [exportJob, setExportJob] = useState<ExportJob>();
  const [problem, setProblem] = useState<string>();

  const [profiles, setProfiles] = useState<DeliveryProfilesState>();
  const [profileChoice, setProfileChoice] = useState<string>();
  const [packageJob, setPackageJob] = useState<PackageJob>();
  const [packageProblem, setPackageProblem] = useState<string>();

  useEffect(() => {
    let active = true;
    api
      .exportState()
      .then((state) => active && setExportJob(state))
      .catch((error) => active && setProblem(apiErrorMessage(error)));
    api
      .packageState()
      .then((state) => active && setPackageJob(state))
      .catch((error) => active && setPackageProblem(apiErrorMessage(error)));
    api
      .deliveryProfiles()
      .then((state) => {
        if (!active) return;
        setProfiles(state);
        setProfileChoice((current) => current ?? state.projectProfile);
      })
      .catch((error) => active && setProblem(apiErrorMessage(error)));
    return () => {
      active = false;
    };
  }, [api]);

  const exportRunning = exportJob?.phase === 'running';
  useEffect(() => {
    if (!exportRunning) return;
    let active = true;
    const timer = setTimeout(() => {
      api
        .exportState()
        .then((state) => active && setExportJob(state))
        .catch((error) => active && setProblem(apiErrorMessage(error)));
    }, POLL_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, exportRunning, exportJob]);

  const packageRunning = packageJob?.phase === 'running';
  useEffect(() => {
    if (!packageRunning) return;
    let active = true;
    const timer = setTimeout(() => {
      api
        .packageState()
        .then((state) => active && setPackageJob(state))
        .catch((error) => active && setPackageProblem(apiErrorMessage(error)));
    }, POLL_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, packageRunning, packageJob]);

  const choose = async () => {
    setPicking(true);
    setProblem(undefined);
    try {
      const picked = await api.exportPickFiles();
      if (picked.paths.length === 0) return;
      setItems((current) => {
        const existing = new Set(current.map((item) => item.path));
        const added = picked.paths.filter((path) => !existing.has(path)).map((path): ExportItem => ({ kind: 'chapter', title: titleFromPath(path), path }));
        return [...current, ...added];
      });
    } catch (error) {
      setProblem(apiErrorMessage(error));
    } finally {
      setPicking(false);
    }
  };

  const updateItem = (path: string, patch: Partial<ExportItem>) =>
    setItems((current) => current.map((item) => (item.path === path ? { ...item, ...patch } : item)));
  const removeItem = (path: string) => setItems((current) => current.filter((item) => item.path !== path));

  const startExport = async () => {
    setProblem(undefined);
    try {
      setExportJob(await api.exportStart({ items, master, format: 'mp3' }));
    } catch (error) {
      setProblem(apiErrorMessage(error));
    }
  };
  const cancelExport = () => void api.exportCancel().then(setExportJob, (error) => setProblem(apiErrorMessage(error)));

  const doneFiles = exportJob?.files.filter((file) => file.status === 'done' && file.encodedPath) ?? [];
  const canPackage = doneFiles.length > 0 && exportJob?.phase !== 'running' && !!profileChoice;

  const startPackage = async () => {
    setPackageProblem(undefined);
    const profile = profiles?.profiles.find((candidate) => deliveryProfileKey(candidate) === profileChoice);
    if (!profile) return;
    const packageItems: PackageItem[] = doneFiles.map((file) => ({ kind: file.kind, title: file.title, path: file.encodedPath as string }));
    try {
      setPackageJob(await api.packageStart({ profileId: profile.id, profileVersion: profile.version, items: packageItems }));
    } catch (error) {
      setPackageProblem(apiErrorMessage(error));
    }
  };
  const cancelPackage = () => void api.packageCancel().then(setPackageJob, (error) => setPackageProblem(apiErrorMessage(error)));

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Files to master and encode"
        actions={
          <Button onClick={() => void choose()} pending={picking} disabled={exportRunning}>
            Choose files…
          </Button>
        }
      >
        {problem && (
          <p role="alert" className="mt-2 text-sm" style={DANGER}>
            {problem}
          </p>
        )}
        {items.length === 0 && !exportJob?.files.length ? (
          <p className="mt-2 text-sm" style={MUTED}>
            Choose rendered chapter, credits and retail-sample files (WAV) to master, encode and package.
          </p>
        ) : (
          <div
            tabIndex={0}
            className="mt-2 overflow-x-auto focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none focus-visible:ring-inset"
          >
            <Table label="Files to export">
              <TableHead>
                <TableRow>
                  <TableHeader>File</TableHeader>
                  <TableHeader>Role</TableHeader>
                  <TableHeader>Title</TableHeader>
                  <TableHeader>Status</TableHeader>
                  <TableHeader hiddenLabel="Remove" />
                </TableRow>
              </TableHead>
              <TableBody>
                {(exportJob?.files.length ? exportJob.files : items).map((item) => {
                  const result = exportJob?.files.find((file) => file.path === item.path);
                  return (
                    <TableRow key={item.path}>
                      <TableCell className="text-sm">{fileName(item.path)}</TableCell>
                      <TableCell>
                        {exportJob?.files.length ? (
                          KIND_OPTIONS.find((option) => option.value === item.kind)?.label
                        ) : (
                          <Select
                            label={`Role for ${fileName(item.path)}`}
                            value={item.kind}
                            onChange={(value) => updateItem(item.path, { kind: value as PackageItemKind })}
                            options={KIND_OPTIONS}
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        {item.kind === 'chapter' &&
                          (exportJob?.files.length ? (
                            item.title
                          ) : (
                            <TextField
                              label={`Title for ${fileName(item.path)}`}
                              value={item.title}
                              onChange={(value) => updateItem(item.path, { title: value })}
                            />
                          ))}
                      </TableCell>
                      <TableCell className="text-sm" style={result?.status === 'failed' ? DANGER : result?.status === 'done' ? OK : MUTED}>
                        {result ? exportRowStatus(result) : 'Not started'}
                      </TableCell>
                      <TableCell>
                        {!exportJob?.files.length && (
                          <Button variant="ghost" onClick={() => removeItem(item.path)}>
                            Remove
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {items.length > 0 && !exportJob?.files.length && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Checkbox checked={master} onChange={setMaster}>
              Master before encoding (EQ, limiter, gain to the delivery profile&apos;s RMS window)
            </Checkbox>
            <Button onClick={() => void startExport()}>Master &amp; encode</Button>
          </div>
        )}
        {exportJob && exportJob.phase === 'running' && (
          <div className="mt-3 flex flex-col gap-2">
            <ProgressBar label="Preparing files" value={exportJob.percent} running valueText={`${exportJob.percent}% prepared`} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p aria-live="polite" className="text-sm">
                {exportJob.message}
              </p>
              <Button variant="ghost" onClick={cancelExport}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {exportJob && exportJob.phase !== 'running' && exportJob.phase !== 'idle' && (
          <p aria-live="polite" className="mt-2 text-sm" style={exportJob.phase === 'error' ? DANGER : undefined}>
            {exportJob.message}
          </p>
        )}
      </Panel>

      {doneFiles.length > 0 && (
        <Panel
          title="Delivery package"
          actions={
            profiles && (
              <div className="flex items-center gap-2">
                <Select
                  label="Delivery profile"
                  value={profileChoice ?? ''}
                  onChange={setProfileChoice}
                  options={profiles.profiles.map((candidate) => ({ value: deliveryProfileKey(candidate), label: deliveryProfileTitle(candidate) }))}
                />
                <Button onClick={() => void startPackage()} disabled={!canPackage} pending={packageJob?.phase === 'running'}>
                  Build package
                </Button>
              </div>
            )
          }
        >
          {packageProblem && (
            <p role="alert" className="mt-2 text-sm" style={DANGER}>
              {packageProblem}
            </p>
          )}
          {packageJob && packageJob.phase === 'running' && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <ProgressBar label="Building the package" value={null} running className="flex-1" />
              <Button variant="ghost" onClick={cancelPackage}>
                Cancel
              </Button>
            </div>
          )}
          {packageJob && packageJob.phase !== 'running' && packageJob.phase !== 'idle' && (
            <>
              <p aria-live="polite" className="mt-2 text-sm" style={packageJob.phase === 'error' ? DANGER : OK}>
                {packageJob.message}
              </p>
              {packageJob.checklist.length > 0 && (
                <div
                  tabIndex={0}
                  className="mt-2 overflow-x-auto focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none focus-visible:ring-inset"
                >
                  <Table label="Delivery package checklist">
                    <TableHead>
                      <TableRow>
                        <TableHeader>Rule</TableHeader>
                        <TableHeader>Status</TableHeader>
                        <TableHeader>Detail</TableHeader>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {packageJob.checklist.map((item) => (
                        <TableRow key={item.ruleId}>
                          <TableCell className="text-sm font-medium">{item.label}</TableCell>
                          <TableCell className="text-sm" style={item.status === 'missing' ? DANGER : item.status === 'included' ? OK : MUTED}>
                            {item.status === 'included' ? 'Included' : item.status === 'missing' ? 'Missing' : item.status === 'off' ? 'Off' : 'Not applicable'}
                          </TableCell>
                          <TableCell className="text-sm" style={MUTED}>
                            {item.detail}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {packageJob.files.length > 0 && (
                <p className="mt-2 text-sm" style={MUTED}>
                  {packageJob.files.length} {packageJob.files.length === 1 ? 'file' : 'files'} written to {packageJob.outputDir}.
                </p>
              )}
            </>
          )}
        </Panel>
      )}
    </div>
  );
}
