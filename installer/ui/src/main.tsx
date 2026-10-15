import React, {lazy, Suspense, useCallback, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {invoke} from '@tauri-apps/api/core';
import {AnimatePresence, domAnimation, LazyMotion, m, MotionConfig, useReducedMotion} from 'motion/react';
import {toast} from 'sonner';
import {Toaster} from './components/ui/sonner';
import {ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, CircleAlert, CircleHelp, Copy, Download, FolderOpen, HardDrive, LoaderCircle, Monitor, Moon, Pause, RefreshCw, RotateCcw, Settings2, ShieldCheck, Smartphone, Sun, Upload, Usb} from 'lucide-react';
import {Button} from './components/ui/button';
import {helpStrings} from './help-i18n';
import {strings, type Language} from './i18n';
import {gib, native, request, stateGroup, subscribe, type Device, type Package, type Transaction, type Transfer} from './protocol';
import './style.css';

const HelpCenter = lazy(() => import('./components/help-center').then(module => ({default:module.HelpCenter})));
const GettingStarted = lazy(() => import('./components/help-center').then(module => ({default:module.GettingStarted})));

type View = 'home' | 'install' | 'update' | 'resume' | 'boot' | 'advanced' | 'plan' | 'progress';
function App() {
  const [lang, setLang] = useState<Language>(localStorage.getItem('language') === 'en' ? 'en' : 'zh');
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(() => {
    const saved = localStorage.getItem('theme');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  });
  const t = strings[lang];
  const help = helpStrings[lang];
  const [helpOpen, setHelpOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [helpTopic, setHelpTopic] = useState('start');
  const [view, setView] = useState<View>('home');
  const [pkg, setPkg] = useState<Package>();
  const [path, setPath] = useState('');
  const [devices, setDevices] = useState<Device[]>([]);
  const [serial, setSerial] = useState('');
  const [device, setDevice] = useState<Device>();
  const [records, setRecords] = useState<Transaction[]>([]);
  const [tx, setTx] = useState<Transaction>();
  const [transfer, setTransfer] = useState<Transfer>();
  const [method, setMethod] = useState('part');
  const [size, setSize] = useState('4');
  const [grow, setGrow] = useState(true);
  const [host, setHost] = useState('192.168.9.1');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [since, setSince] = useState(Date.now());
  const pending = useRef(0);
  const lastTransaction = useRef('');
  const pageRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const append = useCallback((text: string) => setLogs(old => [...old.slice(-499), `${new Date().toLocaleTimeString()}  ${text}`]), []);
  const reportError = useCallback((message: string) => {
    toast.error(t.error, {id: 'operation-error', description: message, duration: Infinity});
    append(message);
  }, [append, t.error]);
  const acceptTransaction = useCallback((next: Transaction, announce = true) => {
    const key = `${next.id}:${next.stage}:${next.status}:${next.error?.message || ''}`;
    if (key !== lastTransaction.current) {
      lastTransaction.current = key;
      setSince(Date.now()); setTransfer(undefined);
      const label = t.stages[next.stage as keyof typeof t.stages] || next.stage;
      append(label);
      if (announce) {
        const options = {id: 'installation-status', description: next.error?.message ||
          (next.status === 'ready' ? t.readyStatus : (t as unknown as Record<string, string>)[next.status]), duration: next.status === 'failed' ? Infinity : 5000};
        if (next.status === 'failed') toast.error(label, options);
        else if (next.status === 'completed') toast.success(next.choices.method === 'boot' ? t.successBoot : next.choices.method === 'update' ? t.successUpdate : t.success, options);
        else if (next.status.startsWith('waiting')) toast.info(label, options);
        else toast.message(label, options);
      }
    }
    setTx(next);
  }, [append, t]);
  const task = async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    pending.current++; setBusy(true);
    toast.dismiss('operation-error');
    const notice = success ? toast.loading(t.running) : undefined;
    try {
      const value = await fn();
      if (notice !== undefined) {
        if (value === false) toast.dismiss(notice);
        else toast.success(success, {id:notice});
      }
      return value;
    } catch (e) {if (notice !== undefined) toast.dismiss(notice); reportError(String(e)); return undefined;}
    finally {pending.current--; setBusy(pending.current > 0);}
  };
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const update = () => document.documentElement.classList.toggle('dark', theme === 'dark' || theme === 'system' && query.matches);
    update(); query.addEventListener('change', update); localStorage.setItem('theme', theme);
    return () => query.removeEventListener('change', update);
  }, [theme]);
  useEffect(() => {localStorage.setItem('language', lang); document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';}, [lang]);
  useEffect(() => {pageRef.current?.querySelector<HTMLElement>('h1')?.focus({preventScroll: true});}, [view]);
  useEffect(() => {
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - since)/1000)), 1000);
    return () => clearInterval(timer);
  }, [since]);
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    subscribe(event => {
      if (event.type === 'transaction') {
        const next = event.data as Transaction;
        acceptTransaction(next);
      } else if (event.type === 'transfer') setTransfer(event.data as Transfer);
      else if (event.type === 'log') append((event.data as {message: string}).message);
      else if (event.type === 'close_blocked') reportError(t.closeBlocked);
      else if (event.type === 'backend_exit') reportError(t.noBackend);
    }).then(stop => {if (cancelled) stop(); else dispose = stop;}).catch(e => {if (!cancelled) reportError(String(e));});
    return () => {cancelled = true; dispose?.();};
  }, [append, acceptTransaction, reportError, t]);
  useEffect(() => {
    task(async () => {
      const hello = await request<{package_path: string; transactions: Transaction[]}>('hello');
      setPath(hello.package_path); setRecords(hello.transactions);
      if (!hello.transactions.length && !localStorage.getItem('onboarding-v1')) setGuideOpen(true);
    });
  }, []);
  const verify = async (folder = path) => {
    setPkg(undefined); setDevice(undefined);
    const p = await task(() => request<Package>('package', {path: folder}), t.verified);
    if (p) {setPkg(p); setPath(p.path); setHost(p.adapter === 'e5' ? '192.168.9.1' : '192.168.77.1'); append(t.verified);}
  };
  const refresh = async () => {
    const values = await task(() => request<Device[]>('devices'));
    if (values) {
      setDevices(values);
      if (values.length === 1) {setSerial(values[0].serial); if (values[0].serial !== serial) setDevice(undefined);}
      else if (!values.some(d => d.serial === serial)) {setSerial(''); setDevice(undefined);}
      if (!values.length) toast.info(t.noDevices);
      else if (values.length > 1) toast.info(t.multipleDevices, {id:'device-selection'});
      else toast.success(t.refreshed);
    }
  };
  const inspect = async () => {
    setDevice(undefined);
    const value = await task(() => request<Device>('probe', {serial, method: view === 'boot' ? 'boot' : method}), t.inspected);
    if (value) {setDevice(value); if (value.existing && view === 'install') setMethod('reinstall'); else if (value.tf && view === 'install') setMethod('tf');}
  };
  const navigate = async (next: View) => {
    setView(next); setAccepted(false); setTransfer(undefined); setDevice(undefined);
    if (next === 'resume') {const values = await task(() => request<Transaction[]>('list')); if (values) setRecords(values);}
    if (['install','advanced','boot'].includes(next)) {if (next === 'boot') setMethod('boot'); else setMethod('part'); if (pkg) await refresh();}
    if (next === 'update') setMethod('update');
  };
  const plan = async () => {
    const value = await task(() => request<Transaction>('plan', {serial, choices: {method, size_gib: Number(size), grow, host}, password}));
    if (value) {acceptTransaction(value); setView('plan'); setAccepted(false);}
  };
  const start = async (command: string, record = tx) => {
    if (!record) return;
    const value = await task(() => request<Transaction>(command, {transaction: record.id, confirmed: command === 'start', password, path: pkg?.path || path}));
    if (value) {acceptTransaction(value); setView('progress'); setSince(Date.now()); setTransfer(undefined);}
  };
  const exportBackup = async () => {
    if (!tx) return;
    await task(async () => {const target = await native('save_backup');
      if (!target) return false;
      return request('export', {transaction: tx.id, path: target});
    }, t.exportedBackup);
  };
  const exportLogs = async () => {
    await task(async () => {const target = await native('save_log');
      if (!target) return false;
      return invoke('write_log', {path: target, text: logs.join('\n')});
    }, t.exportedLog);
  };
  const choosePackage = async () => {
    const folder = await task(() => native('pick_package'));
    if (folder) {setPath(folder); await verify(folder);}
  };
  const openData = () => task(() => native('open_data'), t.openedData);
  const statusLabel = (status: string) => status === 'ready' ? t.readyStatus : (t as unknown as Record<string, string>)[status] || status;
  const stageLabel = (stage: string) => t.stages[stage as keyof typeof t.stages] || stage;
  const current = stateGroup(['plan','progress'].includes(view) ? tx?.stage || 'plan' : 'plan');
  const active = tx && ['running', 'waiting_device', 'waiting_user'].includes(tx.status);
  const openHelp = useCallback(() => {
    setHelpTopic(view === 'resume' || view === 'progress' && (['failed','completed'].includes(tx?.status || '') || tx?.stage === 'openwrt_boot') ? 'recovery' : view === 'progress' && ['android_boot','android_setup'].includes(tx?.stage || '') ? 'reset' : view === 'progress' && tx?.status.startsWith('waiting') ? 'faq' : view === 'plan' ? 'storage' : view === 'home' ? 'start' : 'purpose');
    setGuideOpen(false); setHelpOpen(true);
  }, [view, tx?.status, tx?.stage]);
  const showGuide = () => {setHelpOpen(false); setGuideOpen(true);};
  const changeGuide = (open:boolean) => {
    setGuideOpen(open);
    if (!open) localStorage.setItem('onboarding-v1','seen');
  };
  useEffect(() => {
    const onKey = (event:KeyboardEvent) => {
      if (event.key === 'F1') {event.preventDefault(); if (!guideOpen && !helpOpen) openHelp();}
    };
    window.addEventListener('keydown',onKey);
    return () => window.removeEventListener('keydown',onKey);
  }, [openHelp, guideOpen, helpOpen]);
  const purposes = [
    {id:'install', icon:Download, title:t.install, description:t.installDesc},
    {id:'update', icon:RefreshCw, title:t.update, description:t.updateDesc},
    {id:'resume', icon:RotateCcw, title:t.resume, description:t.resumeDesc},
    {id:'boot', icon:Usb, title:t.boot, description:t.bootDesc},
    {id:'advanced', icon:Settings2, title:t.advanced, description:t.advancedDesc},
  ] as const;
  const impact = tx?.plan.wipe ? t.wipe : tx?.choices.method === 'tf' ? t.tfErase : tx?.choices.method === 'reinstall' ? t.reinstallErase : tx?.choices.method === 'image' ? t.imageImpact : tx?.choices.method === 'update' ? t.updateImpact : tx?.choices.method === 'boot' ? t.bootImpact : t.preserve;
  return <div className="app-shell">
    <header><div className="brand"><div className="brand-icon"><HardDrive size={20}/></div><div><strong>{t.title}</strong><small>{t.subtitle}</small></div></div>
      <div className="preferences"><label className="sr-only" htmlFor="language">{t.language}</label><select id="language" value={lang} onChange={e => setLang(e.target.value as Language)}><option value="zh">中文</option><option value="en">English</option></select>
        {theme === 'dark' ? <Moon size={16}/> : theme === 'light' ? <Sun size={16}/> : <Monitor size={16}/>}
        <label className="sr-only" htmlFor="theme">{t.theme}</label><select id="theme" value={theme} onChange={e => setTheme(e.target.value as typeof theme)}><option value="system">{t.system}</option><option value="light">{t.light}</option><option value="dark">{t.dark}</option></select><Button variant="ghost" className="help-trigger" onClick={openHelp} aria-label={help.help} title={`${help.help} (F1)`}><CircleHelp size={18}/><span>{help.help}</span></Button></div>
    </header>
    <div className="workspace"><aside><button className="nav-home" disabled={busy || !!active} onClick={() => navigate('home')}><HardDrive size={17}/>{t.home}</button>
      <ol className="stepper">{t.steps.map((name, i) => <li key={name} className={current === i ? 'current' : current > i ? 'done' : ''}><span>{current > i ? <Check size={14}/> : i+1}</span><div>{name}</div></li>)}</ol>
      <div className="sidebar-bottom"><div className="sidebar-note"><ShieldCheck size={19}/><p>{t.packageHint}</p></div>
      <Button variant="ghost" className="data-folder" disabled={busy} onClick={openData}><FolderOpen size={16}/>{t.openData}</Button></div>
    </aside><main aria-busy={busy}>
      <div className="busy-track" aria-hidden="true">{busy && <m.div animate={{opacity:reduceMotion ? 1 : [.4,1,.4]}} transition={{duration:1.3,repeat:reduceMotion ? 0 : Infinity}}/>}</div>
      <AnimatePresence initial={false} mode="wait" onExitComplete={() => requestAnimationFrame(() => pageRef.current?.querySelector<HTMLElement>('h1')?.focus({preventScroll:true}))}>
      <m.div key={view} ref={pageRef} className="page" initial={{opacity:0, y:reduceMotion ? 0 : 8}} animate={{opacity:1,y:0}} exit={{opacity:0}} transition={{duration:reduceMotion ? 0 : 0.16, ease:'easeOut'}}>
      {view === 'home' && <><div className="eyebrow">OPENWRT · DESKTOP INSTALLER</div><h1 tabIndex={-1}>{lang === 'zh' ? '你想如何使用 OpenWrt？' : 'What would you like to do?'}</h1><p className="intro">{t.connect}</p>
        <div className="guide-callout"><BookOpen size={20}/><div><strong>{help.firstTime}</strong><p>{help.firstTimeDesc}</p></div><Button variant="outline" onClick={showGuide}>{help.guide}<ArrowRight size={15}/></Button></div>
        <div className="purpose-list scroll-area">{purposes.map(({id, icon:Icon, title, description}, index) => <m.button initial={{opacity:0,y:reduceMotion ? 0 : 6}} animate={{opacity:1,y:0}} transition={{delay:reduceMotion ? 0 : index*0.025,duration:0.18}} whileHover={reduceMotion ? undefined : {x:3}} whileTap={reduceMotion ? undefined : {scale:0.992}} key={id} disabled={busy} onClick={() => navigate(id)} className="purpose"><div className="purpose-icon"><Icon size={21}/></div><div><h2>{title}</h2><p>{description}</p></div><ArrowRight size={18}/></m.button>)}</div>
      </>}
      {['install','update','boot','advanced'].includes(view) && <><h1 tabIndex={-1}>{purposes.find(p => p.id === view)?.title}</h1><p className="intro">{purposes.find(p => p.id === view)?.description}</p>
        <div className="page-scroll scroll-area"><section><div className="section-title"><h2>{t.package}</h2>{pkg && <span className="badge"><Check size={13}/>{t.verified}</span>}</div>
          <div className="package-row"><div className="file-path" title={path}>{pkg?.name || path || t.choosePackage}</div><Button variant="outline" disabled={busy} onClick={choosePackage}><FolderOpen size={16}/>{t.choosePackage}</Button><Button disabled={busy || !path} onClick={() => verify()}>{t.verify}</Button></div></section>
        {view === 'update' ? <section><h2>{t.device}</h2><div className="form-grid"><label>{t.host}<input disabled={busy} value={host} onChange={e => setHost(e.target.value)} autoComplete="off"/></label><label>{t.password}<input disabled={busy} type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="off"/></label></div><Button variant="outline" disabled={busy || !pkg} onClick={async () => {setDevice(undefined); const d = await task(() => request<Device>('probe_update', {host, password}), t.inspected); if (d) setDevice(d);}}>{t.checkUpdate}</Button></section> : <section><div className="section-title"><h2>{t.device}</h2><Button variant="ghost" disabled={!pkg || busy} onClick={refresh}><RefreshCw size={15}/>{t.refresh}</Button></div><div className="device-select"><Smartphone size={18}/><select disabled={busy} aria-label={t.select} value={serial} onChange={e => {setSerial(e.target.value); setDevice(undefined);}}><option value="">{t.select}</option>{devices.map(d => <option key={d.serial} value={d.serial}>{d.label} · ••••{d.serial.slice(-4)} · {t.deviceStates[d.state as keyof typeof t.deviceStates] || d.state}</option>)}</select><Button variant="outline" disabled={!serial || !pkg || busy} onClick={inspect}>{t.inspect}</Button></div></section>}
        {view === 'boot' && <section><h2>{t.visit}</h2><div className="form-grid"><label>{t.host}<input disabled={busy} value={host} onChange={e => setHost(e.target.value)} autoComplete="off"/></label><label>{t.password}<input disabled={busy} type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="off"/></label></div></section>}
        {device && <div className="device-card"><div><small>{t.model}</small><strong>{device.model || t.unknown}</strong></div><div><small>{t.os}</small><strong>{device.system || t.unknown}</strong></div><div><small>{t.slot}</small><strong>{device.slot || t.unknown}</strong></div><div><small>{t.root}</small><strong className={device.root ? 'good-text' : ''}>{device.root ? t.ready : t.unavailable}</strong></div></div>}
        {device?.readiness && device.readiness !== 'ready' && <div className="alert"><CircleAlert size={19}/><div><strong>{stageLabel(device.readiness)}</strong><p>{t.waitingAndroid}</p></div></div>}
        {view !== 'update' && view !== 'boot' && <section><h2>{t.install}</h2><div className="method-options" role="group" aria-label={t.install}>{(view === 'advanced' ? ['reinstall','image'] : device?.existing ? ['reinstall'] : ['tf','part']).map(m => <button disabled={busy} key={m} aria-pressed={method === m} className={method === m ? 'selected' : ''} onClick={() => setMethod(m)}>{m === 'tf' ? <Usb size={17}/> : <HardDrive size={17}/>}{(t as unknown as Record<string,string>)[m]}{(m === 'tf' && device?.tf || m === 'reinstall' && device?.existing) && <span>{t.recommended}</span>}</button>)}</div>
          {method === 'image' && <div className="alert danger"><CircleAlert size={18}/><strong>{t.experimental}</strong></div>}
          {['part','image'].includes(method) && <label className="size-field">{t.size}<input disabled={busy} type="number" min="2" step="0.25" value={size} onChange={e => setSize(e.target.value)}/></label>}
          {['part','reinstall'].includes(method) && <label className="checkbox-label"><input disabled={busy} type="checkbox" checked={grow} onChange={e => setGrow(e.target.checked)}/><div>{t.grow}<small>{t.growHelp}</small></div></label>}
        </section>}
        </div><div className="actions"><Button disabled={busy} variant="ghost" onClick={() => navigate('home')}>{t.back}</Button><Button disabled={busy || !pkg || !device?.root} onClick={plan}>{t.plan}<ArrowRight size={16}/></Button></div>
      </>}
      {view === 'plan' && tx && <><div className="eyebrow">{t.review}</div><h1 tabIndex={-1}>{tx.device.model}</h1><p className="intro">{tx.package.name} · ••••{tx.device.serial.slice(-4)}</p><div className="page-scroll scroll-area"><section><dl className="plan-list"><div><dt>{t.target}</dt><dd>{tx.plan.target}</dd></div><div><dt>{t.android}</dt><dd>{gib(tx.plan.android_bytes)}</dd></div><div><dt>{t.allocation}</dt><dd>{tx.choices.method === 'boot' ? '—' : gib(tx.plan.openwrt_bytes)}</dd></div><div><dt>{t.grow}</dt><dd>{tx.plan.grow ? <Check size={17}/> : '—'}</dd></div></dl></section>
        <div className={'alert ' + (tx.plan.wipe || tx.plan.experimental ? 'danger' : '')}><CircleAlert size={20}/><div><strong>{t.impact}</strong><p>{impact}</p>{tx.plan.experimental && <p>{t.experimental}</p>}</div></div>
        {(tx.plan.offline || tx.plan.two_stage) && <div className="alert"><RefreshCw size={20}/><p>{t.firstBoot}</p></div>}
        </div><label className="checkbox-label confirmation"><input disabled={busy} type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)}/>{t.accept}</label>
        <div className="actions"><Button disabled={busy} variant="outline" onClick={() => navigate('install')}>{t.back}</Button><Button variant={tx.plan.wipe ? 'destructive' : 'default'} disabled={!accepted || busy} onClick={() => start('start')}>{t.start}<ArrowRight size={16}/></Button></div>
      </>}
      {view === 'resume' && <><h1 tabIndex={-1}>{t.resume}</h1><p className="intro">{t.resumeDesc}</p><div className="resume-tools"><Button variant="outline" disabled={busy} onClick={async () => {const folder = await task(() => native('pick_recovery')); if (folder) {const value = await task(() => request<Transaction>('import', {path: folder}), t.imported); if (value) setRecords(old => [value, ...old.filter(r => r.id !== value.id)]);}}}><Upload size={16}/>{t.import}</Button><Button variant="outline" disabled={busy} onClick={choosePackage}><FolderOpen size={16}/>{t.choosePackage}</Button></div>
        <label className="resume-password"><span>{t.password}</span><input disabled={busy} type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="off"/></label>
        <div className="records-list scroll-area">{!records.length && <p className="empty-state">{t.noRecords}</p>}{records.map(r => <section className="record" key={r.id}><div><h2>{r.device.model}</h2><p>{stageLabel(r.stage)} · {statusLabel(r.status)}</p><small>{new Date(r.updated*1000).toLocaleString()} · {r.id.slice(0,8)}</small></div><Button disabled={busy} onClick={() => start('resume', r)}>{t.continue}<ArrowRight size={16}/></Button></section>)}</div>
      </>}
      {view === 'progress' && tx && <><div className="eyebrow">{t.progress} · {tx.device.model}</div><h1 tabIndex={-1}>{tx.status === 'completed' ? tx.choices.method === 'boot' ? t.successBoot : tx.choices.method === 'update' ? t.successUpdate : t.success : stageLabel(tx.stage)}</h1><div className="status-line"><span className={'status-dot '+tx.status}/><span>{statusLabel(tx.status)}</span><span className="elapsed">{t.elapsed} {elapsed}s</span></div>
        <div className="page-scroll scroll-area">{tx.status === 'completed' ? <section className="success-panel"><m.div className="success-icon" initial={{opacity:0,scale:reduceMotion ? 1 : .9}} animate={{opacity:1,scale:1}} transition={{duration:reduceMotion ? 0 : .24}}><CheckCircle2 size={42} className="good-text"/></m.div><dl className="plan-list"><div><dt>{t.actual}</dt><dd>{gib(tx.result?.filesystem_bytes)}</dd></div><div><dt>{t.visit}</dt><dd>{tx.result?.url}</dd></div></dl><h2>{t.next}</h2><p>{t.nextDesc}</p></section> : <>
          <section className="activity"><m.div key={tx.stage+tx.status} className="activity-heading" initial={{opacity:reduceMotion ? 1 : 0,y:reduceMotion ? 0 : 4}} animate={{opacity:1,y:0}} transition={{duration:reduceMotion ? 0 : .18}}>{tx.status === 'failed' ? <CircleAlert size={28}/> : tx.status === 'running' ? <LoaderCircle size={28} className="spin"/> : tx.status.startsWith('waiting') ? <Smartphone size={28}/> : <Pause size={28}/>}<div><h2>{stageLabel(tx.stage)}</h2><p>{tx.package.name}</p></div></m.div>
            {transfer && tx.status === 'running' && <div className="transfer"><div><span>{transfer.name}</span><span>{Math.floor(transfer.bytes/transfer.total*100)}%</span></div><progress value={transfer.bytes} max={transfer.total}/><small>{t.bytes}: {gib(transfer.bytes)} / {gib(transfer.total)} · {t.speed}: {(transfer.bytes_per_second/1048576).toFixed(1)} MiB/s</small></div>}
            {tx.status.startsWith('waiting') && <><p className="waiting-guidance">{tx.stage === 'openwrt_boot' ? t.waitingOpenwrt : t.waitingAndroid}</p><Button variant="ghost" className="context-help" onClick={openHelp}><CircleHelp size={16}/>{help.currentHelp}</Button></>}
            {tx.unsafe && <div className="alert danger"><ShieldCheck size={19}/><p>{t.unsafe}</p></div>}
            {tx.error && <div className="alert danger"><CircleAlert size={20}/><p>{tx.error.message}</p></div>}
          </section></>} </div>{tx.status !== 'completed' && <div className="actions">{active ? <Button variant="outline" disabled={busy} onClick={() => task(() => request('cancel'), t.pauseRequested)}><Pause size={16}/>{t.pause}</Button> : <Button disabled={busy || tx.error?.retryable === false} onClick={() => start('retry')}>{t.retry}<RotateCcw size={16}/></Button>}</div>
        }
        <div className="backup-actions"><Button disabled={busy} variant="outline" onClick={exportBackup}><Download size={16}/>{t.exportBackup}</Button><Button disabled={busy} variant="ghost" onClick={openData}><FolderOpen size={16}/>{t.openData}</Button></div>
      </>}
      </m.div></AnimatePresence>
      <div className="log-panel"><button className="log-toggle" aria-expanded={logOpen} aria-controls="installation-log" onClick={() => setLogOpen(!logOpen)}><ChevronDown size={14}/>{t.logs}<span>{logs.length}</span></button>
        <AnimatePresence initial={false}>{logOpen && <m.div id="installation-log" className="log-content" initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}} transition={{duration:reduceMotion ? 0 : .18}}><div className="log-inner"><div className="log-actions"><Button variant="ghost" disabled={busy || !logs.length} onClick={() => task(() => navigator.clipboard.writeText(logs.join('\n')), t.copied)}><Copy size={14}/>{t.copy}</Button><Button variant="ghost" disabled={busy || !logs.length} onClick={exportLogs}><Download size={14}/>{t.exportLog}</Button></div><pre tabIndex={0} aria-label={t.logs}>{logs.join('\n') || '—'}</pre></div></m.div>}</AnimatePresence>
      </div>
    </main></div><footer><span><ShieldCheck size={13}/>OpenWrt Installer · v1.0</span><span>USB / SSH · {pkg?.profile || '—'}</span></footer>
    <Suspense fallback={<div className="help-loading" role="status"><LoaderCircle size={17} className="spin"/>{t.running}</div>}>{helpOpen && <HelpCenter language={lang} open={helpOpen} onOpenChange={setHelpOpen} initialTopic={helpTopic} onGuide={showGuide}/>}
    {guideOpen && <GettingStarted language={lang} open={guideOpen} onOpenChange={changeGuide}/>}</Suspense>
    <Toaster theme={theme} containerAriaLabel={t.notifications} toastOptions={{closeButtonAriaLabel:t.dismiss, classNames:{toast:"app-toast",description:"toast-description"}}}/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><MotionConfig reducedMotion="user"><LazyMotion features={domAnimation} strict><App/></LazyMotion></MotionConfig></React.StrictMode>);
