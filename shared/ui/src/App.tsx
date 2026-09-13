import { FormEvent, useEffect, useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBookOpen, faCircleNotch, faFileAudio, faGear, faHouse, faPlay, faRotate, faWandMagicSparkles, faXmark } from '@fortawesome/free-solid-svg-icons';
import type { Bootstrap, Discrepancy, GuideEntity, NarrationApi, Scope, SettingField, TranscriptState } from './types';
import { hasCompleteApi, hasCompleteMethodList, hasReadyApi, isTranscriptActive } from './state';

const EMPTY: TranscriptState = { phase: 'idle', percent: 0, message: 'Select a track in REAPER, then start a comparison.', logs: [], chapters: [], rows: [], diff: '', summary: '', elapsed: 0 };
const api = (): NarrationApi | undefined => window.pywebview?.api;
const seconds = (value: number) => `${Math.floor(value / 60).toString().padStart(2, '0')}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
const projectTime = (value: number) => seconds(value);

export function App() {
  const [data, setData] = useState<Bootstrap>();
  const [page, setPage] = useState('Home');
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const [startup, setStartup] = useState<'connecting' | 'bootstrapping' | 'error' | 'timeout'>('connecting');
  const [startupError, setStartupError] = useState('');
  const [diagnosticId, setDiagnosticId] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    let starting = false;
    const pause = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
    const load = async () => {
      const host = api();
      if (!hasReadyApi(host) || starting) return;
      starting = true;
      setStartup('bootstrapping');
      try {
        const ready = await host.ready();
        if (ready.apiVersion !== 1) throw new Error(`Desktop host API version ${ready.apiVersion} is incompatible with this UI.`);
        if (!hasCompleteMethodList(ready.methods)) throw new Error('Desktop host published an incomplete API contract.');
        setDiagnosticId(ready.diagnosticId);
        // pywebview creates the rest of its proxies immediately after ready(),
        // but allow older WebView2 bridges one short, bounded publication turn.
        for (let attempt = 0; attempt < 20 && !hasCompleteApi(api()); attempt += 1) await pause(25);
        if (!hasCompleteApi(api())) throw new Error('Desktop host API methods were not fully published.');
        const next = await host.bootstrap();
        if (next && active) { setDiagnosticId(next.diagnosticId); setData(next); setRevision(1); }
      }
      catch (error) {
        const message = String(error);
        const completeHost = api();
        if (hasCompleteApi(completeHost)) void completeHost.reportClientDiagnostic('bootstrap_failed', message);
        if (active) { setStartup('error'); setStartupError(message); }
      }
    };
    const ready = () => void load();
    const clientError = (event: ErrorEvent) => { const host = api(); if (hasCompleteApi(host)) void host.reportClientDiagnostic('window_error', event.message); };
    const rejection = (event: PromiseRejectionEvent) => { const host = api(); if (hasCompleteApi(host)) void host.reportClientDiagnostic('unhandled_rejection', String(event.reason)); };
    window.addEventListener('pywebviewready', ready);
    window.addEventListener('error', clientError);
    window.addEventListener('unhandledrejection', rejection);
    void load();
    const retry = window.setInterval(() => void load(), 100);
    const timeout = window.setTimeout(() => { if (active && !data) { setStartup('timeout'); setStartupError('The desktop-host handshake did not finish within 10 seconds.'); } }, 10_000);
    return () => { active = false; window.clearInterval(retry); window.clearTimeout(timeout); window.removeEventListener('pywebviewready', ready); window.removeEventListener('error', clientError); window.removeEventListener('unhandledrejection', rejection); };
  }, [retryKey]);

  useEffect(() => {
    if (!data) return;
    const timer = window.setInterval(async () => {
      try { const next = await api()?.poll(revision); if (next && next.revision !== revision) { setRevision(next.revision); setData((current) => current ? { ...current, transcript: next.transcript } : current); } }
      catch { /* transient host shutdown; retain the visible state */ }
    }, 350);
    return () => window.clearInterval(timer);
  }, [data, revision]);

  if (!data) return <StartupScreen state={startup} error={startupError} diagnosticId={diagnosticId} retry={() => { setStartup('connecting'); setStartupError(''); setRetryKey((value) => value + 1); }} />;
  const nav = [{ name: 'Home', icon: faHouse }, { name: 'Manuscript Guide', icon: faBookOpen }, { name: 'Transcript Compare', icon: faFileAudio }, { name: 'Roadmap', icon: faWandMagicSparkles }];
  return <div className="min-h-screen bg-slate-950 text-slate-100"><header className="flex h-12 items-center justify-between border-b border-slate-700 bg-slate-900 px-4 text-sm"><strong>Narration Utils</strong><span className="text-slate-400">{data.projectName}</span></header><div className="flex min-h-[calc(100vh-3rem)]"><aside className="w-56 shrink-0 border-r border-slate-800 bg-slate-900/70 p-3 max-md:absolute max-md:z-10 max-md:w-full max-md:border-b"><div className="mb-4 px-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Workspace</div><nav className="flex gap-1 md:flex-col">{nav.map((item) => <NavButton key={item.name} active={page === item.name} icon={item.icon} onClick={() => setPage(item.name)}>{item.name}</NavButton>)}</nav><div className="mt-5 border-t border-slate-800 pt-3"><NavButton active={page === 'Settings'} icon={faGear} onClick={() => setPage('Settings')}>Settings</NavButton></div></aside><main className="min-w-0 flex-1 p-6 pt-6 max-md:pt-32">{page === 'Home' && <Home data={data} go={setPage} />}{page === 'Manuscript Guide' && <Guide notify={setNotice} />}{page === 'Transcript Compare' && <Transcript state={data.transcript} notify={setNotice} />}{page === 'Settings' && <Settings data={data} update={setData} notify={setNotice} />}{page === 'Roadmap' && <Roadmap data={data} />}{notice && <div className="fixed bottom-4 right-4 max-w-md rounded-md border border-sky-700 bg-slate-900 p-3 text-sm shadow-xl" role="status">{notice}<button className="ml-3 text-slate-400" aria-label="Dismiss message" onClick={() => setNotice('')}><FontAwesomeIcon icon={faXmark} /></button></div>}</main></div></div>;
}

function StartupScreen({ state, error, diagnosticId, retry }: { state: 'connecting' | 'bootstrapping' | 'error' | 'timeout'; error: string; diagnosticId: string; retry: () => void }) {
  const waiting = state === 'connecting' || state === 'bootstrapping';
  const detail = state === 'connecting' ? 'Waiting for the complete desktop-host API…' : state === 'bootstrapping' ? 'Reading project context from the desktop host…' : state === 'timeout' ? 'The desktop host did not publish its API within 10 seconds.' : error;
  return <div className="grid min-h-screen place-items-center bg-slate-950 p-6 text-slate-200"><div className="max-w-lg rounded-lg border border-slate-700 bg-slate-900 p-6 text-center shadow-2xl"><div className="text-lg font-semibold">{waiting ? <><FontAwesomeIcon icon={faCircleNotch} spin className="mr-2" />Opening Narration Utils…</> : 'Desktop host needs attention'}</div><p className="mt-3 text-sm text-slate-400">{detail}</p>{diagnosticId && <p className="mt-3 font-mono text-xs text-slate-500">Diagnostic: {diagnosticId}</p>}{!waiting && <button className="primary mt-5" onClick={retry}><FontAwesomeIcon icon={faRotate} className="mr-2" />Retry connection</button>}</div></div>;
}

function NavButton({ active, icon, children, onClick }: { active: boolean; icon: typeof faHouse; children: string; onClick: () => void }) { return <button className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${active ? 'bg-sky-900/70 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'}`} onClick={onClick}><FontAwesomeIcon icon={icon} className="w-4" />{children}</button>; }
function Panel({ children }: { children: React.ReactNode }) { return <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">{children}</section>; }
function Heading({ title, children }: { title: string; children: string }) { return <><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-1 text-sm text-slate-400">{children}</p></>; }

function Home({ data, go }: { data: Bootstrap; go: (page: string) => void }) { return <div className="mx-auto max-w-5xl space-y-6"><Heading title="Project workspace">Choose a workflow for the active REAPER project.</Heading><Panel><div className="text-xs uppercase tracking-wide text-slate-500">Active project</div><div className="mt-1 font-medium">{data.projectName}</div><div className="mt-3 text-sm text-slate-400">Manuscript: {data.manuscriptPath || 'Not selected'}</div><button className="mt-3 text-sm text-sky-300 hover:text-sky-200" onClick={async () => { const result = await api()?.selectManuscript(); if (result?.path) location.reload(); }}>Select manuscript</button></Panel><div className="grid gap-4 md:grid-cols-2"><Panel><h2 className="font-medium">Manuscript Guide</h2><p className="mt-2 text-sm text-slate-400">Review characters, pronunciation, evidence, and local voice previews.</p><button className="primary mt-4" onClick={() => go('Manuscript Guide')}>Open guide</button></Panel><Panel><h2 className="font-medium">Transcript Compare</h2><p className="mt-2 text-sm text-slate-400">Compare the selected chapter track, then review markers and discrepancies.</p><button className="primary mt-4" onClick={() => go('Transcript Compare')}>Open compare</button></Panel></div></div>; }

function Guide({ notify }: { notify: (text: string) => void }) {
  const [rows, setRows] = useState<GuideEntity[]>([]); const [selected, setSelected] = useState<GuideEntity>(); const [query, setQuery] = useState('');
  const load = async () => { try { const next = await api()?.guideIndex() || []; setRows(next); setSelected((current) => next.find((row) => row.id === current?.id) || next[0]); } catch (error) { notify(String(error)); } };
  useEffect(() => { void load(); }, []);
  const filtered = rows.filter((row) => `${row.name} ${row.category}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="mx-auto max-w-6xl space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><Heading title="Manuscript Guide">Build and review a local reference from the project manuscript.</Heading><div className="flex gap-2"><button className="secondary" onClick={async () => { try { notify(await api()!.guideBuild()); await load(); } catch (error) { notify(String(error)); } }}>Build / refresh</button><button className="secondary" onClick={async () => { try { notify(`Hotwords exported to ${await api()!.guideExport()}`); } catch (error) { notify(String(error)); } }}>Export hotwords</button></div></div><div className="grid gap-4 lg:grid-cols-[minmax(250px,.8fr)_minmax(0,1.2fr)]"><Panel><label className="label">Search entities<input className="input mt-1" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or category" /></label><div className="mt-3 max-h-[32rem] space-y-1 overflow-auto">{filtered.map((row) => <button key={row.id} className={`w-full rounded px-3 py-2 text-left text-sm ${selected?.id === row.id ? 'bg-sky-900/70' : 'hover:bg-slate-800'}`} onClick={() => setSelected(row)}><span className="block font-medium">{row.name}</span><span className="text-xs text-slate-400">{row.category} · {row.count} hits</span></button>)}</div></Panel><GuideDetail entity={selected} reload={load} notify={notify} /></div></div>;
}

function GuideDetail({ entity, reload, notify }: { entity?: GuideEntity; reload: () => Promise<void>; notify: (text: string) => void }) {
  const [draft, setDraft] = useState<GuideEntity>(); useEffect(() => setDraft(entity), [entity]); if (!draft) return <Panel>No matching entities. Build the guide to discover names and terms.</Panel>;
  const set = (key: keyof GuideEntity, value: string) => setDraft({ ...draft, [key]: value }); const locks = draft.locks.split(';').map((value) => value.trim()).filter(Boolean);
  return <Panel><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-medium">{draft.name}</h2><p className="text-sm text-slate-400">{draft.category} · {draft.count} occurrences</p></div><button className="secondary" onClick={async () => { try { notify(`Preview opened: ${await api()!.guidePreview(draft.id)}`); } catch (error) { notify(String(error)); } }}>Play preview</button></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><Field label="Name" value={draft.name} onChange={(value) => set('name', value)} /><Field label="Category" value={draft.category} onChange={(value) => set('category', value)} /><Field label="Say it as" value={draft.say} onChange={(value) => set('say', value)} /><Field label="IPA" value={draft.ipa} onChange={(value) => set('ipa', value)} /></div><Field label="Description" textarea value={draft.description} onChange={(value) => set('description', value)} /><Field label="Personality notes" textarea value={draft.traits} onChange={(value) => set('traits', value)} /><Field label="Locked fields (semicolon-separated)" value={draft.locks} onChange={(value) => set('locks', value)} /><div className="mt-4 flex flex-wrap gap-2"><button className="primary" onClick={async () => { try { await api()!.guideEdit(draft.id, { canonical_name: draft.name, category: draft.category, say_as: draft.say, ipa: draft.ipa, description: draft.description, personality: draft.traits }, locks); notify('Guide entry saved.'); await reload(); } catch (error) { notify(String(error)); } }}>Save entry</button></div><div className="mt-6 border-t border-slate-800 pt-4 text-sm text-slate-400"><strong className="text-slate-300">Evidence · {draft.chapter}</strong><p className="mt-1 whitespace-pre-wrap">{draft.evidence || 'No supporting evidence.'}</p></div></Panel>;
}

function Field({ label, value, onChange, textarea = false }: { label: string; value: string; onChange: (value: string) => void; textarea?: boolean }) { return <label className="label mt-3 block">{label}{textarea ? <textarea className="input mt-1 min-h-20" value={value} onChange={(event) => onChange(event.target.value)} /> : <input className="input mt-1" value={value} onChange={(event) => onChange(event.target.value)} />}</label>; }

function Transcript({ state, notify }: { state: TranscriptState; notify: (text: string) => void }) {
  const [model, setModel] = useState('small'), [chunk, setChunk] = useState('Whole file'), [workers, setWorkers] = useState('Auto'), [hints, setHints] = useState(''); const [selected, setSelected] = useState<Discrepancy>();
  useEffect(() => { if (!selected && state.rows[0]) setSelected(state.rows[0]); }, [selected, state.rows]);
  const running = isTranscriptActive(state.phase);
  const start = async (chapterTitle?: string) => { try { await api()!.transcriptStart({ model, chunk, workers, hints, chapterTitle }); } catch (error) { notify(String(error)); } };
  return <div className="mx-auto max-w-6xl space-y-5"><Heading title="Transcript Compare">Compare the selected REAPER chapter track with its manuscript chapter.</Heading><Panel><div className="grid gap-3 md:grid-cols-3"><Select label="Whisper model" value={model} values={['tiny', 'base', 'small', 'medium', 'large-v3']} onChange={setModel} /><Select label="Chunking" value={chunk} values={['Whole file', '30 seconds', '1 minute', '5 minutes', '15 minutes', '1 hour']} onChange={setChunk} /><Select label="Parallel workers" value={workers} values={['Auto', '1', '2', '4', '8']} onChange={setWorkers} /></div><label className="label mt-4 block">Vocabulary hints<div className="mt-1 flex flex-wrap gap-2"><input className="input min-w-60 flex-1" value={hints} onChange={(event) => setHints(event.target.value)} placeholder="Names and invented terms" /><button className="secondary" onClick={async () => { try { setHints(await api()!.transcriptSuggestHints()); } catch (error) { notify(String(error)); } }}>Suggest from manuscript</button></div></label><div className="mt-5 flex items-center justify-between gap-4"><span className="text-sm text-slate-400">{state.message}</span>{running ? <button className="danger" onClick={() => void api()?.transcriptCancel()}>Cancel comparison</button> : <button className="primary" onClick={() => void start()}><FontAwesomeIcon icon={faPlay} className="mr-2" />Start comparison</button>}</div></Panel>{state.phase === 'need_chapter' && <Panel><h2 className="font-medium">Choose manuscript chapter</h2><p className="mt-1 text-sm text-slate-400">The track name did not confidently match a chapter.</p><div className="mt-3 flex flex-wrap gap-2">{state.chapters.map((chapter) => <button className="secondary" key={chapter} onClick={() => void start(chapter)}>{chapter}</button>)}</div></Panel>}<Panel><div className="flex justify-between text-sm"><span>{state.phase === 'success' ? state.summary : state.message}</span><span>{state.percent}% · {seconds(state.elapsed)}</span></div><div className="mt-3 h-2 overflow-hidden rounded bg-slate-800"><div className="h-full bg-sky-500 transition-all" style={{ width: `${state.percent}%` }} /></div>{state.logs.length > 0 && <details className="mt-3 text-xs text-slate-400"><summary>Activity log</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap">{state.logs.join('\n')}</pre></details>}</Panel><Results state={state} selected={selected} select={setSelected} notify={notify} /></div>;
}

function Select({ label, value, values, onChange }: { label: string; value: string; values: string[]; onChange: (value: string) => void }) { return <label className="label">{label}<select className="input mt-1" value={value} onChange={(event) => onChange(event.target.value)}>{values.map((choice) => <option key={choice}>{choice}</option>)}</select></label>; }
function Results({ state, selected, select, notify }: { state: TranscriptState; selected?: Discrepancy; select: (row: Discrepancy) => void; notify: (text: string) => void }) { return <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,.8fr)]"><Panel><h2 className="mb-3 font-medium">Discrepancies</h2><div className="overflow-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-500"><tr><th>Time</th><th>Type</th><th>Manuscript</th><th>Recorded</th></tr></thead><tbody>{state.rows.map((row) => <tr key={row.id} className={`cursor-pointer border-t border-slate-800 ${row.id === selected?.id ? 'bg-sky-950/60' : 'hover:bg-slate-800/60'}`} onClick={() => select(row)}><td className="p-2">{projectTime(row.projectTime)}</td><td className="p-2 text-amber-300">{row.kind}</td><td className="p-2">{row.docText || '—'}</td><td className="p-2">{row.audioText || '—'}</td></tr>)}</tbody></table>{state.phase === 'success' && state.rows.length === 0 && <p className="p-3 text-sm text-slate-400">No discrepancies found.</p>}</div></Panel><Panel><h2 className="font-medium">{selected ? `${projectTime(selected.projectTime)} · ${selected.kind}` : 'Selected discrepancy'}</h2>{selected ? <><pre className="mt-3 whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs text-slate-300">Manuscript: {selected.docText || '—'}{`\n`}Recorded: {selected.audioText || '—'}</pre><div className="mt-3 flex flex-wrap gap-2"><button className="secondary" onClick={() => void api()?.transcriptJump(selected.id)}>Jump to marker</button><button className="secondary" onClick={async () => { try { notify(await api()!.transcriptAddEquivalence(selected.id)); } catch (error) { notify(String(error)); } }}>Add equivalence</button></div></> : <p className="mt-2 text-sm text-slate-400">Select a result to review its text evidence.</p>}{state.diff && <details className="mt-5 text-sm"><summary>Diff</summary><pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs text-slate-300">{state.diff}</pre></details>}</Panel></div>; }

function Settings({ data, update, notify }: { data: Bootstrap; update: (next: Bootstrap) => void; notify: (text: string) => void }) { const [tool, setTool] = useState('ManuscriptGuide'); const [scope, setScope] = useState<Scope>('global'); const fields = data.settings[tool] || []; const [values, setValues] = useState<Record<string, string>>({}); useEffect(() => setValues(Object.fromEntries(fields.map((field) => [field.key, field.value]))), [tool, data]); const save = async (event: FormEvent) => { event.preventDefault(); try { update(await api()!.saveSettings(tool, scope, values)); notify('Settings saved.'); } catch (error) { notify(String(error)); } }; return <div className="mx-auto max-w-3xl space-y-5"><Heading title="Settings">Configure shared defaults or project-specific overrides.</Heading><form onSubmit={save}><Panel><div className="grid gap-3 sm:grid-cols-2"><Select label="Tool" value={tool} values={Object.keys(data.settings)} onChange={setTool} /><Select label="Scope" value={scope} values={['global', 'project']} onChange={(value) => setScope(value as Scope)} /></div><div className="mt-5 space-y-3">{fields.map((field) => <Setting key={field.key} field={field} value={values[field.key] ?? ''} change={(value) => setValues({ ...values, [field.key]: value })} />)}</div><button className="primary mt-5" type="submit">Save {scope} settings</button></Panel></form></div>; }
function Setting({ field, value, change }: { field: SettingField; value: string; change: (value: string) => void }) { return <label className="label block">{field.label}<span className="ml-2 text-xs text-slate-500">{field.source.replace('_', ' ')}</span>{field.kind === 'choice' ? <select className="input mt-1" value={value} onChange={(event) => change(event.target.value)}>{field.choices.map((choice) => <option key={choice}>{choice}</option>)}</select> : <input className="input mt-1" type={field.kind === 'color' ? 'text' : 'text'} value={value} onChange={(event) => change(event.target.value)} />}</label>; }
function Roadmap({ data }: { data: Bootstrap }) { return <div className="mx-auto max-w-3xl space-y-5"><Heading title="Product roadmap">Current utilities and planned milestones.</Heading><Panel><div className="space-y-4">{data.roadmap.available.map((item) => <div key={item.title}><div className="font-medium">Available now · {item.title}</div><p className="text-sm text-slate-400">{item.summary}</p></div>)}{data.roadmap.milestones.map((item) => <div key={item.number}><div className="font-medium">Milestone {item.number} · {item.title}</div><p className="text-sm text-slate-400">{item.summary}</p></div>)}</div></Panel></div>; }
