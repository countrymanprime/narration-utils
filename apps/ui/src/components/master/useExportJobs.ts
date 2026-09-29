import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import type { DeliveryProfile, ExportItem, ExportJob, PackageItem, PackageJob } from '../../types';

/** How often a running export or package job is read. */
const POLL_MS = 500;

/** The file name, with its extension, for display and labels. */
export const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

/** The file name without its extension, seeded as a chapter's default title. */
const titleFromPath = (path: string): string => fileName(path).replace(/\.[^.]+$/, '');

/**
 * Master & QC's export and package jobs (render-encode-master.prd.md Phase 5): the narrator picks rendered files, gives each a role
 * and (for a chapter) a title, masters them to spec (internal/masteringport's chain, on by default: the mock's "Master all to
 * spec"), encodes them (internal/encodeport) and assembles one delivery profile's package (internal/packager). One hook, so the
 * files panel and the package panel beside it read the same jobs. The host keeps both jobs, so leaving the page and coming back
 * shows them again, and one still running is followed. Nothing here changes a source file: every stage writes a new one.
 */
export function useExportJobs() {
  const api = useApi();
  const [picking, setPicking] = useState(false);
  const [items, setItems] = useState<ExportItem[]>([]);
  const [master, setMaster] = useState(true);
  const [exportJob, setExportJob] = useState<ExportJob>();
  const [problem, setProblem] = useState<string>();
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

  const pick = async () => {
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

  const startPackage = async (profile: DeliveryProfile) => {
    setPackageProblem(undefined);
    const packageItems: PackageItem[] = doneFiles.map((file) => ({ kind: file.kind, title: file.title, path: file.encodedPath as string }));
    try {
      setPackageJob(await api.packageStart({ profileId: profile.id, profileVersion: profile.version, items: packageItems }));
    } catch (error) {
      setPackageProblem(apiErrorMessage(error));
    }
  };
  const cancelPackage = () => void api.packageCancel().then(setPackageJob, (error) => setPackageProblem(apiErrorMessage(error)));

  return {
    picking,
    items,
    master,
    setMaster,
    exportJob,
    exportRunning,
    problem,
    pick,
    updateItem,
    removeItem,
    startExport,
    cancelExport,
    doneFiles,
    packageJob,
    packageRunning,
    packageProblem,
    startPackage,
    cancelPackage,
  };
}

export type ExportJobs = ReturnType<typeof useExportJobs>;
