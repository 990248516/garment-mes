import { useEffect, useMemo, useRef, useState } from 'react';
import type { components } from '@garment-mes/api-client';

import {
  checkCurrentSession,
  clearSession,
  completeWork,
  errorMessage,
  getPiecework,
  loginErrorMessage,
  loginWorker,
  resolveBundle,
  restoreWorkerSession,
  startWork,
  type PieceworkPeriod,
} from './api';

type View = 'scan' | 'tasks' | 'income';
type SyncState = 'online' | 'checking' | 'offline';
type AuthSession = components['schemas']['AuthSession'];
type BundleScanView = components['schemas']['BundleScanView'];
type WorkReport = components['schemas']['WorkReport'];
type MyPieceworkView = components['schemas']['MyPieceworkView'];
type PieceworkEntry = components['schemas']['PieceworkEntry'];

interface Quantities {
  inputQty: number;
  goodQty: number;
  defectQty: number;
  missingQty: number;
}

const emptyQuantities: Quantities = { inputQty: 0, goodQty: 0, defectQty: 0, missingQty: 0 };
const periodLabels: Record<PieceworkPeriod, string> = { TODAY: '今日', WEEK: '本周', MONTH: '本月' };

export function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [view, setView] = useState<View>('scan');
  const [scanResult, setScanResult] = useState<BundleScanView | null>(null);
  const [piecework, setPiecework] = useState<MyPieceworkView | null>(null);
  const [period, setPeriod] = useState<PieceworkPeriod>('TODAY');
  const [lastPiecework, setLastPiecework] = useState<PieceworkEntry | null>(null);
  const [busy, setBusy] = useState<string | null>('restore');
  const [message, setMessage] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>(navigator.onLine ? 'online' : 'offline');
  const [deepLinkCode, setDeepLinkCode] = useState<string | null>(() => {
    const value = new URLSearchParams(window.location.search).get('bundle')?.trim();
    return value && value.length >= 4 ? value : null;
  });

  useEffect(() => {
    let cancelled = false;
    void restoreWorkerSession()
      .then(async (restoredSession) => {
        if (cancelled || !restoredSession) return;
        setSession(restoredSession);
        setPiecework(await getPiecework('TODAY'));
        setSyncState('online');
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const updateOnlineState = () => setSyncState(navigator.onLine ? 'online' : 'offline');
    window.addEventListener('online', updateOnlineState);
    window.addEventListener('offline', updateOnlineState);
    return () => {
      window.removeEventListener('online', updateOnlineState);
      window.removeEventListener('offline', updateOnlineState);
    };
  }, []);

  useEffect(() => {
    if (!session || !deepLinkCode) return;
    const code = deepLinkCode;
    setDeepLinkCode(null);
    window.history.replaceState({}, '', window.location.pathname);
    void handleResolve(code);
  }, [deepLinkCode, session]);

  async function handleLogin(account: string, secret: string, organizationCode: string) {
    setBusy('login');
    setMessage(null);
    try {
      const nextSession = await loginWorker(account, secret, organizationCode.trim() || undefined);
      setSession(nextSession);
      const today = await getPiecework('TODAY');
      setPiecework(today);
      setSyncState('online');
    } catch (error) {
      clearSession();
      setMessage(loginErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  function handleLogout() {
    clearSession();
    setSession(null);
    setScanResult(null);
    setPiecework(null);
    setLastPiecework(null);
    setView('scan');
    setMessage(null);
  }

  async function checkConnection() {
    if (!navigator.onLine || !session) {
      setSyncState('offline');
      return;
    }
    setSyncState('checking');
    try {
      await checkCurrentSession();
      setSyncState('online');
    } catch (error) {
      setSyncState('offline');
      setMessage(errorMessage(error));
    }
  }

  async function handleResolve(code: string) {
    setBusy('resolve');
    setMessage(null);
    setLastPiecework(null);
    try {
      setScanResult(await resolveBundle(code));
    } catch (error) {
      setScanResult(null);
      setMessage(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleStart(bundleRouteStepId: string) {
    if (!scanResult) return;
    setBusy('start');
    setMessage(null);
    try {
      const result = await startWork(scanResult.bundle.id, bundleRouteStepId);
      setScanResult({
        ...scanResult,
        bundle: result.bundle,
        eligibleOperations: [],
        warnings: result.warnings ?? [],
        serverTime: result.serverTime,
      });
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function handleComplete(report: WorkReport, quantities: Quantities, defectCode: string) {
    if (!scanResult) return;
    setBusy('complete');
    setMessage(null);
    try {
      const result = await completeWork(report.id, {
        ...quantities,
        defects: quantities.defectQty > 0 && defectCode.trim()
          ? [{ defectCode: defectCode.trim(), quantity: quantities.defectQty }]
          : [],
        quantityOverride: false,
      });
      setLastPiecework(result.pieceworkEntry);
      setScanResult({
        ...scanResult,
        bundle: result.bundle,
        eligibleOperations: [],
        warnings: [],
        serverTime: result.serverTime,
      });
      setPiecework(await getPiecework(period));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function loadPiecework(nextPeriod: PieceworkPeriod) {
    setBusy('piecework');
    setMessage(null);
    setPeriod(nextPeriod);
    try {
      setPiecework(await getPiecework(nextPeriod));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  if (!session) {
    return <LoginScreen busy={busy === 'login' || busy === 'restore'} message={message} onLogin={handleLogin} />;
  }

  const activeReport = scanResult?.bundle.activeWorkReport ?? null;
  const todayAmount = period === 'TODAY' ? piecework?.estimatedAmount : null;

  return (
    <div className="app-shell">
      <header className="worker-header">
        <button className="brand" onClick={() => setView('scan')} aria-label="返回扫码首页">
          <span className="brand-mark">YC</span>
          <span>云裁报工</span>
        </button>
        <button className={`connection ${syncState}`} onClick={checkConnection}>
          <span aria-hidden="true" />
          {syncState === 'checking' ? '检测中' : syncState === 'online' ? '网络正常' : '连接异常'}
        </button>
      </header>

      <main className="worker-main">
        {message && <div className="message error" role="alert">{message}<button onClick={() => setMessage(null)}>关闭</button></div>}

        {view === 'scan' && (
          <>
            <section className="welcome-row" aria-labelledby="welcome-title">
              <div>
                <p>你好，{session.user.displayName}</p>
                <h1 id="welcome-title">今天继续加油</h1>
                <button className="logout-button" onClick={handleLogout}>退出登录</button>
              </div>
              <button className="income-pill" onClick={() => { setView('income'); void loadPiecework('TODAY'); }}>
                <span>今日预计计件</span>
                <strong>{money(todayAmount ?? '0')}</strong>
                <small>查看明细</small>
              </button>
            </section>

            {!scanResult ? (
              <ScanForm busy={busy === 'resolve'} onResolve={handleResolve} />
            ) : (
              <BundleWorkCard
                result={scanResult}
                lastPiecework={lastPiecework}
                busy={busy}
                onStart={handleStart}
                onComplete={handleComplete}
                onScanNext={() => { setScanResult(null); setLastPiecework(null); setMessage(null); }}
              />
            )}

            <section className="current-tasks">
              <div className="section-heading"><h2>当前任务</h2><button onClick={() => setView('tasks')}>查看任务</button></div>
              {activeReport ? <TaskCard report={activeReport} onOpen={() => setView('scan')} /> : <EmptyState text="扫码并开工后，当前任务会显示在这里。" />}
            </section>
          </>
        )}

        {view === 'tasks' && (
          <Page title="我的任务" subtitle="只显示当前真实报工任务" onBack={() => setView('scan')}>
            {activeReport ? <TaskCard report={activeReport} onOpen={() => setView('scan')} /> : <EmptyState text="当前没有进行中的任务，请先扫描扎包。" />}
          </Page>
        )}

        {view === 'income' && (
          <Page title="我的计件" subtitle="金额透明，每一笔都可追溯" onBack={() => setView('scan')}>
            <PieceworkView data={piecework} period={period} busy={busy === 'piecework'} onPeriodChange={loadPiecework} />
          </Page>
        )}
      </main>

      <nav className="bottom-nav" aria-label="主要导航">
        <NavButton label="扫码" active={view === 'scan'} onClick={() => setView('scan')} icon={<ScanIcon />} />
        <NavButton label="任务" active={view === 'tasks'} onClick={() => setView('tasks')} icon={<TasksIcon />} />
        <NavButton label="计件" active={view === 'income'} onClick={() => { setView('income'); void loadPiecework(period); }} icon={<IncomeIcon />} />
      </nav>
    </div>
  );
}

function LoginScreen({ busy, message, onLogin }: {
  busy: boolean;
  message: string | null;
  onLogin: (account: string, secret: string, organizationCode: string) => Promise<void>;
}) {
  const [account, setAccount] = useState('');
  const [secret, setSecret] = useState('');
  const [organizationCode, setOrganizationCode] = useState('');

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand"><span className="brand-mark">YC</span><div><strong>云裁报工</strong><small>一扎一码 · 透明计件</small></div></div>
        <div className="login-copy"><p>工人登录</p><h1>开始今天的生产任务</h1><span>使用工号和 PIN 登录；扫码进入时，登录后会自动继续当前扎包。</span></div>
        {message && <div className="message error" role="alert">{message}</div>}
        <form onSubmit={(event) => { event.preventDefault(); void onLogin(account.trim(), secret, organizationCode); }}>
          <label>工号或用户名<input autoComplete="username" value={account} onChange={(event) => setAccount(event.target.value)} placeholder="例如 W001" required /></label>
          <label>密码或 PIN<input type="password" autoComplete="current-password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="请输入密码或 PIN" minLength={4} required /></label>
          <label>组织代码 <small>选填</small><input autoCapitalize="characters" value={organizationCode} onChange={(event) => setOrganizationCode(event.target.value.toUpperCase())} placeholder="有同名工号时填写" /></label>
          <button className="primary-button" disabled={busy}>{busy ? '正在登录…' : '登录并开始报工'}</button>
        </form>
        <p className="login-help">无法登录？请联系现场主管检查账号、工种或工厂权限。</p>
      </section>
    </main>
  );
}

function scannedBundleCode(rawValue: string) {
  const value = rawValue.trim();
  if (!value) return '';
  try {
    const url = new URL(value, window.location.href);
    const bundle = url.searchParams.get('bundle')?.trim();
    if (bundle) return bundle.toUpperCase();
  } catch {
    // A printed short code or bundle number is expected to be a non-URL value.
  }
  return value.toUpperCase();
}

function cameraErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return '未获得摄像头权限，请在浏览器设置中允许访问，或改用手工输入。';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return '未找到可用摄像头，请改用手工输入。';
  if (name === 'NotReadableError' || name === 'AbortError') return '摄像头正被其他应用占用，请关闭其他相机应用后重试。';
  return '无法启动摄像头。请确认使用 HTTPS 打开页面，或改用手工输入。';
}

function ScannerModal({ onDetected, onClose }: { onDetected: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDetectedRef = useRef(onDetected);
  const onCloseRef = useRef(onClose);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    onDetectedRef.current = onDetected;
    onCloseRef.current = onClose;
  }, [onClose, onDetected]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    let controls: { stop: () => void } | null = null;
    let disposed = false;
    let accepted = false;

    const stopVideo = () => {
      controls?.stop();
      const stream = video.srcObject;
      if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);

    void import('@zxing/browser').then(({ BrowserQRCodeReader }) => {
      if (disposed) return null;
      const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 120 });
      return reader.decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: 'environment' } } },
        video,
        (result, _error, liveControls) => {
          if (!result || accepted || disposed) return;
          const code = scannedBundleCode(result.getText());
          if (code.length < 4 || code.length > 80) {
            setCameraError('二维码内容不是有效的扎包短码，请对准扎包卡片重新扫描。');
            return;
          }
          accepted = true;
          liveControls.stop();
          onDetectedRef.current(code);
        },
      );
    }).then((nextControls) => {
      if (!nextControls) return;
      controls = nextControls;
      if (disposed) stopVideo();
    }).catch((error: unknown) => {
      if (!disposed) setCameraError(cameraErrorMessage(error));
    });

    return () => {
      disposed = true;
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      stopVideo();
    };
  }, []);

  return (
    <div className="scanner-overlay" role="dialog" aria-modal="true" aria-labelledby="scanner-title">
      <section className="scanner-dialog">
        <header>
          <div><small>摄像头扫码</small><h2 id="scanner-title">对准扎包二维码</h2></div>
          <button className="scanner-close" onClick={onClose} aria-label="关闭摄像头" autoFocus>×</button>
        </header>
        <div className="camera-preview">
          <video ref={videoRef} autoPlay playsInline muted aria-label="摄像头实时画面" />
          <div className="camera-frame" aria-hidden="true">
            <i className="corner top-left" /><i className="corner top-right" /><i className="corner bottom-left" /><i className="corner bottom-right" />
            <i className="scan-line camera-scan-line" />
          </div>
        </div>
        {cameraError ? <div className="camera-message error" role="alert">{cameraError}</div> : <p className="camera-message" aria-live="polite">正在识别，保持二维码完整出现在框内</p>}
        <p className="camera-privacy">相机画面仅用于本机识码，不会上传或保存。</p>
        <button className="secondary-button" onClick={onClose}>关闭并手工输入</button>
      </section>
    </div>
  );
}

function ScanForm({ busy, onResolve }: { busy: boolean; onResolve: (code: string) => Promise<void> }) {
  const [code, setCode] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const handleDetected = (value: string) => {
    setCode(value);
    setScannerOpen(false);
    void onResolve(value);
  };

  return (
    <section className="scan-card">
      <div className="scan-visual" aria-hidden="true"><i className="corner top-left" /><i className="corner top-right" /><i className="corner bottom-left" /><i className="corner bottom-right" /><QrIcon /></div>
      <h2>扫描或输入扎包卡片</h2>
      <p>扫描扎包二维码，系统会自动核对你的工种技能。</p>
      <div className="scan-form">
        <button type="button" className="camera-button" disabled={busy} onClick={() => setScannerOpen(true)}><CameraIcon />打开摄像头扫码</button>
        <div className="scan-divider"><span>或手工输入</span></div>
        <form onSubmit={(event) => { event.preventDefault(); void onResolve(code.trim()); }}>
          <label htmlFor="bundle-code">短码 / 扎包号</label>
          <input id="bundle-code" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="例如 A1B2C3D4 或 BED-001" minLength={4} maxLength={80} autoCapitalize="characters" required />
          <button className="primary-button" disabled={busy}>{busy ? '正在识别…' : '识别扎包'}</button>
        </form>
      </div>
      <small className="scan-tip">二维码损坏或相机不可用时，可直接输入卡片上的短码。</small>
      {scannerOpen && <ScannerModal onDetected={handleDetected} onClose={() => setScannerOpen(false)} />}
    </section>
  );
}
function BundleWorkCard({ result, lastPiecework, busy, onStart, onComplete, onScanNext }: {
  result: BundleScanView;
  lastPiecework: PieceworkEntry | null;
  busy: string | null;
  onStart: (stepId: string) => Promise<void>;
  onComplete: (report: WorkReport, quantities: Quantities, defectCode: string) => Promise<void>;
  onScanNext: () => void;
}) {
  const bundle = result.bundle;
  const activeReport = bundle.activeWorkReport ?? null;
  const [quantities, setQuantities] = useState<Quantities>(emptyQuantities);
  const [defectCode, setDefectCode] = useState('');

  useEffect(() => {
    if (!activeReport) return;
    const previous = bundle.routeSteps
      .filter((step) => step.stepNo < (bundle.currentStepNo ?? Number.MAX_SAFE_INTEGER) && step.isRequired)
      .sort((left, right) => right.stepNo - left.stepNo)[0];
    const inputQty = previous?.goodQty ?? bundle.effectiveQty;
    setQuantities({ inputQty, goodQty: inputQty, defectQty: 0, missingQty: 0 });
    setDefectCode('');
  }, [activeReport?.id, bundle.currentStepNo, bundle.effectiveQty, bundle.routeSteps]);

  const balanced = quantities.inputQty === quantities.goodQty + quantities.defectQty + quantities.missingQty;
  return (
    <section className="scan-card identified">
      <span className={`success-label ${bundle.status === 'COMPLETED' ? 'completed' : ''}`}>{bundle.status === 'COMPLETED' ? '完工成功' : activeReport ? '加工中' : '识别成功'}</span>
      <h2>扎包 {bundle.bundleNo}</h2>
      <p>{bundle.styleCode} · {bundle.colorName} / {bundle.sizeName} · {bundle.effectiveQty} 件</p>

      {lastPiecework && <div className="piecework-success"><span>本次计件</span><strong>{money(lastPiecework.amount)}</strong><small>{lastPiecework.processName} · {lastPiecework.quantity} 件</small></div>}

      {bundle.status === 'COMPLETED' ? (
        <button className="primary-button" onClick={onScanNext}>继续扫描下一扎</button>
      ) : activeReport ? (
        <CompletionForm report={activeReport} quantities={quantities} defectCode={defectCode} balanced={balanced} busy={busy === 'complete'} onQuantities={setQuantities} onDefectCode={setDefectCode} onComplete={onComplete} />
      ) : result.eligibleOperations.length > 0 ? (
        <div className="operation-list">
          {result.eligibleOperations.map((operation) => (
            <article key={operation.bundleRouteStepId}>
              <div><strong>{operation.processName}</strong><span>技能 {operation.skillLevel} 级</span></div>
              <p>预计本扎 {money(operation.estimatedAmount)} · 单价 {money(operation.unitRate)}</p>
              <button className="primary-button" disabled={busy === 'start'} onClick={() => void onStart(operation.bundleRouteStepId)}>{busy === 'start' ? '正在开工…' : '确认开工'}</button>
            </article>
          ))}
        </div>
      ) : (
        <div className="message warning">当前没有与你技能匹配的待开工工序，请联系主管。</div>
      )}

      {result.warnings?.map((warning) => <div className="message warning" key={warning}>{warning}</div>)}
      {bundle.status !== 'COMPLETED' && <button className="text-button" onClick={onScanNext}>返回重新扫码</button>}
    </section>
  );
}

function CompletionForm({ report, quantities, defectCode, balanced, busy, onQuantities, onDefectCode, onComplete }: {
  report: WorkReport;
  quantities: Quantities;
  defectCode: string;
  balanced: boolean;
  busy: boolean;
  onQuantities: (value: Quantities) => void;
  onDefectCode: (value: string) => void;
  onComplete: (report: WorkReport, quantities: Quantities, defectCode: string) => Promise<void>;
}) {
  const setQuantity = (key: keyof Quantities, value: string) => onQuantities({ ...quantities, [key]: Math.max(0, Number.parseInt(value || '0', 10)) });
  return (
    <form className="completion-form" onSubmit={(event) => { event.preventDefault(); if (balanced) void onComplete(report, quantities, defectCode); }}>
      <div className="operation-heading"><span>当前工序</span><strong>{report.processName}</strong><small>开工 {formatTime(report.startedAt)}</small></div>
      <div className="quantity-grid">
        <QuantityInput label="投入" value={quantities.inputQty} onChange={(value) => setQuantity('inputQty', value)} readOnly />
        <QuantityInput label="良品" value={quantities.goodQty} onChange={(value) => setQuantity('goodQty', value)} />
        <QuantityInput label="次品" value={quantities.defectQty} onChange={(value) => setQuantity('defectQty', value)} />
        <QuantityInput label="短缺" value={quantities.missingQty} onChange={(value) => setQuantity('missingQty', value)} />
      </div>
      <div className={`balance ${balanced ? 'valid' : 'invalid'}`}>{quantities.inputQty} = {quantities.goodQty} + {quantities.defectQty} + {quantities.missingQty}<strong>{balanced ? '数量平衡' : '请调整数量'}</strong></div>
      {quantities.defectQty > 0 && <label className="defect-field">缺陷代码 <small>用于质量追溯</small><input value={defectCode} onChange={(event) => onDefectCode(event.target.value.toUpperCase())} placeholder="例如 STITCH-SKIP" required /></label>}
      <button className="primary-button" disabled={!balanced || busy}>{busy ? '正在提交…' : `确认完工 · 预计 ${money((Number(report.unitRateSnapshot) * quantities.goodQty).toFixed(4))}`}</button>
    </form>
  );
}

function QuantityInput({ label, value, readOnly, onChange }: { label: string; value: number; readOnly?: boolean; onChange: (value: string) => void }) {
  return <label><span>{label}</span><input type="number" inputMode="numeric" min="0" value={value} readOnly={readOnly} onChange={(event) => onChange(event.target.value)} /></label>;
}

function PieceworkView({ data, period, busy, onPeriodChange }: { data: MyPieceworkView | null; period: PieceworkPeriod; busy: boolean; onPeriodChange: (period: PieceworkPeriod) => Promise<void> }) {
  return (
    <>
      <div className="period-tabs" role="tablist" aria-label="计件周期">{(Object.keys(periodLabels) as PieceworkPeriod[]).map((key) => <button role="tab" aria-selected={period === key} className={period === key ? 'active' : ''} key={key} disabled={busy} onClick={() => void onPeriodChange(key)}>{periodLabels[key]}</button>)}</div>
      <section className="income-hero"><span>{periodLabels[period]}预计计件</span><strong>{money(data?.estimatedAmount ?? '0')}</strong><div><p><b>{money(data?.confirmedAmount ?? '0')}</b>已确认</p><p><b>{money(data?.settledAmount ?? '0')}</b>已结算</p></div></section>
      <div className="summary-grid"><Summary value={String(data?.goodQty ?? 0)} label="良品件数" /><Summary value={String(data?.defectQty ?? 0)} label="次品件数" /><Summary value={String(data?.items.length ?? 0)} label="计件记录" /></div>
      <div className="section-heading"><h2>{periodLabels[period]}明细</h2><span>{data ? `${data.period.from} 至 ${data.period.to}` : '加载中'}</span></div>
      {busy ? <EmptyState text="正在加载计件明细…" /> : data && data.items.length > 0 ? <div className="income-list">{data.items.map((item) => <article key={item.id}><time>{formatTime(item.occurredAt)}</time><div><strong>{item.processName} · {item.bundleNo}</strong><span>{item.quantity} 件 · {pieceworkStatus(item.status)}</span></div><b>{money(item.amount)}</b></article>)}</div> : <EmptyState text="这个周期还没有计件记录。" />}
    </>
  );
}

function TaskCard({ report, onOpen }: { report: WorkReport; onOpen: () => void }) {
  return <article className="task-card"><div className="task-meta"><span className="status active"><i />加工中</span><time>{formatTime(report.startedAt)} 开工</time></div><h3>{report.processName} · 扎包 {report.bundleNo}</h3><p>预计本扎 {money(report.estimatedAmount ?? '0')}</p><button className="secondary-button" onClick={onOpen}>继续报工</button></article>;
}

function EmptyState({ text }: { text: string }) { return <div className="empty-state"><TasksIcon /><p>{text}</p></div>; }
function Page({ title, subtitle, onBack, children }: { title: string; subtitle: string; onBack: () => void; children: React.ReactNode }) { return <section className="page"><div className="page-heading"><button className="back-button" onClick={onBack} aria-label="返回扫码首页"><BackIcon /></button><div><h1>{title}</h1><p>{subtitle}</p></div></div>{children}</section>; }
function Summary({ value, label }: { value: string; label: string }) { return <article><strong>{value}</strong><span>{label}</span></article>; }
function NavButton({ label, active, onClick, icon }: { label: string; active: boolean; onClick: () => void; icon: React.ReactNode }) { return <button className={active ? 'active' : ''} onClick={onClick}>{icon}<span>{label}</span></button>; }
function money(value: string | number) { return `¥${Number(value).toFixed(2)}`; }
function formatTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)); }
function pieceworkStatus(status: string) { return ({ PENDING: '预计', CONFIRMED: '已确认', SETTLED: '已结算', REVERSED: '已冲销' } as Record<string, string>)[status] ?? status; }
function QrIcon() { return <svg viewBox="0 0 24 24"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zm4 0h2v6h-2zm-4 4h2v2h-2z" /></svg>; }
function CameraIcon() { return <svg viewBox="0 0 24 24"><path d="M4 7h4l2-2h4l2 2h4v12H4zM12 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" /></svg>; }
function ScanIcon() { return <svg viewBox="0 0 24 24"><path d="M4 8V4h4m8 0h4v4m0 8v4h-4M8 20H4v-4M8 8h8v8H8z" /></svg>; }
function TasksIcon() { return <svg viewBox="0 0 24 24"><path d="M5 4h14v16H5zM8 9h8m-8 4h8m-8 4h5" /></svg>; }
function IncomeIcon() { return <svg viewBox="0 0 24 24"><path d="M4 6h16v13H4zM4 10h16m-5 4h2" /></svg>; }
function BackIcon() { return <svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg>; }
