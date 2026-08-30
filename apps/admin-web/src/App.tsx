import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

import {
  adminErrorMessage,
  clearAdminSession,
  createOrder,
  createProcess,
  createRouteVersion,
  createColor,
  createSize,
  createStyle,
  createCuttingBed,
  createWorkerAccount,
  createWorker,
  generateBundles,
  getBundleTimeline,
  getOrderBundleWorkDetails,
  listBundles,
  listColors,
  listCustomers,
  listOrders,
  listPieceworkEntries,
  listProcesses,
  listPublishedRouteVersions,
  listRouteVersions,
  listSizes,
  listStyles,
  listWorkerSkills,
  listWorkers,
  listWorkerAccounts,
  listWorkshops,
  listProductionLines,
  loadProductionOverview,
  loginAdmin,
  replaceWorkerSkills,
  releaseOrder,
  replaceRouteVersion,
  resetWorkerAccountPassword,
  restoreAdminSession,
  setWorkerAccountStatus,
  publishRouteVersion,
  updateOrder,
  adjustProcessRate,
  type AdminSessionState,
  type Bundle,
  type BundleEvent,
  type BundleGenerationResult,
  type MasterDataItem,
  type Order,
  type OrderCreate,
  type OrderPatch,
  type OrderItemInput,
  type PieceworkEntry,
  type PieceworkSummary,
  type ProductionOverview,
  type ProductionLine,
  type RouteStepInput,
  type RouteVersion,
  type RouteVersionCreate,
  type RouteVersionReplace,
  type Worker,
  type WorkerAccount,
  type WorkerSkill,
  type WorkerSkillInput,
  type Workshop,
} from './api';

type Page = 'overview' | 'orders' | 'routes' | 'bundles' | 'workers' | 'payroll';
type SyncState = 'idle' | 'syncing' | 'live' | 'error';

const navItems: { id: Page; label: string }[] = [
  { id: 'overview', label: '生产总览' },
  { id: 'orders', label: '生产订单' },
  { id: 'routes', label: '工艺路线' },
  { id: 'bundles', label: '裁床扎包' },
  { id: 'workers', label: '员工工种' },
  { id: 'payroll', label: '计件工资' },
];

interface BundleGenerationSource {
  cuttingBedId: string;
  routeVersionId: string;
  orderItemId: string;
  standardBundleQty: number;
}

interface BundleCardData {
  id?: string;
  orderId?: string;
  cuttingBedId?: string;
  bedNo?: string;
  orderNo?: string;
  styleLabel?: string;
  colorSizeLabel?: string;
  effectiveQty?: number;
  no: string;
  code: string;
  status: string;
  statusCode: string;
  detail: string;
  value: string;
  tone: string;
  generationSource?: BundleGenerationSource;
}


export function App() {
  const [page, setPage] = useState<Page>('overview');
  const [session, setSession] = useState<AdminSessionState | null>(null);
  const [overview, setOverview] = useState<ProductionOverview>();
  const [overviewOrders, setOverviewOrders] = useState<Order[]>([]);
  const [bundleCards, setBundleCards] = useState<BundleCardData[]>([]);
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [authBusy, setAuthBusy] = useState(true);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [routeStyleId, setRouteStyleId] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    void restoreAdminSession()
      .then(async (restoredSession) => {
        if (cancelled || !restoredSession) return;
        setSession(restoredSession);
        await loadLiveData(restoredSession.activeFactoryId);
      })
      .catch((error: unknown) => {
        if (!cancelled) setAdminError(adminErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setAuthBusy(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!session || (page !== 'overview' && page !== 'workers')) return;
    let active = true;
    let refreshing = false;
    const refreshCurrentPage = async () => {
      if (refreshing) return;
      refreshing = true;
      setSyncState('syncing');
      try {
        if (page === 'overview') {
          const [nextOverview, orderPage] = await Promise.all([
            loadProductionOverview(session.activeFactoryId),
            listOrders({ limit: 100 }),
          ]);
          if (active) {
            setOverview(nextOverview);
            setOverviewOrders(orderPage.items);
          }
        } else {
          const nextOverview = await loadProductionOverview(session.activeFactoryId);
          if (active) setOverview(nextOverview);
        }
        if (active) setSyncState('live');
      } catch (error) {
        if (active) {
          setSyncState('error');
          setAdminError(adminErrorMessage(error));
        }
      } finally {
        refreshing = false;
      }
    };
    void refreshCurrentPage();
    const timer = window.setInterval(() => void refreshCurrentPage(), 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [page, session?.activeFactoryId]);

  async function loadLiveData(factoryId: string) {
    setSyncState('syncing');
    const [nextOverview, bundlePage, orderPage] = await Promise.all([
      loadProductionOverview(factoryId),
      listBundles(),
      listOrders({ limit: 100 }),
    ]);
    setOverview(nextOverview);
    setOverviewOrders(orderPage.items);
    setBundleCards(bundlePage.items.map(bundleCardData));
    setSyncState('live');
  }

  async function handleLogin(account: string, secret: string, organizationCode: string) {
    setAuthBusy(true);
    setAdminError(null);
    let loggedIn = false;
    try {
      const nextSession = await loginAdmin({
        account,
        secret,
        ...(organizationCode.trim() ? { organizationCode: organizationCode.trim() } : {}),
      });
      loggedIn = true;
      setSession(nextSession);
      await loadLiveData(nextSession.activeFactoryId);
    } catch (error) {
      if (!loggedIn) {
        clearAdminSession();
        setSession(null);
      }
      setAdminError(adminErrorMessage(error));
      setSyncState('error');
    } finally {
      setAuthBusy(false);
    }
  }

  async function syncOverview() {
    if (!session) return;
    setAdminError(null);
    try {
      await loadLiveData(session.activeFactoryId);
    } catch (error) {
      setSyncState('error');
      setAdminError(adminErrorMessage(error));
    }
  }

  async function handleGenerateBundles(source: BundleGenerationSource): Promise<BundleGenerationResult> {
    const result = await generateBundles(source.cuttingBedId, {
      routeVersionId: source.routeVersionId,
      lines: [{
        orderItemId: source.orderItemId,
        standardBundleQty: source.standardBundleQty,
        allowTailBundle: true,
        authorizedOverproductionQty: 0,
      }],
    });
    await loadLiveData(session!.activeFactoryId);
    return result;
  }

  function openRouteManager(styleId: string) {
    setRouteStyleId(styleId);
    setPage('routes');
  }

  function handleLogout() {
    clearAdminSession();
    setSession(null);
    setOverview(undefined);
    setOverviewOrders([]);
    setBundleCards([]);
    setSyncState('idle');
    setAdminError(null);
  }

  if (!session) {
    return <AdminLoginScreen busy={authBusy} message={adminError} onLogin={handleLogin} />;
  }

  return (
    <div className="admin-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setPage('overview')} aria-label="返回生产总览">
          <span className="brand-mark">YC</span>
          <span><strong>云裁生产</strong><small>YUNCAI MES</small></span>
        </button>
        <nav className="primary-nav" aria-label="管理后台导航">
          {navItems.map((item) => (
            <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => setPage(item.id)}>{item.label}</button>
          ))}
        </nav>
        <div className="top-actions">
          <button className="sync-button" onClick={() => void syncOverview()}>{syncState === 'syncing' ? '同步中' : syncState === 'live' ? '实时数据' : '重新同步'}</button>
          <button className="profile" onClick={handleLogout} aria-label="退出管理端">
            <span>{session.user.displayName.slice(0, 1)}</span><b>{session.user.displayName} · 退出</b>
          </button>
        </div>
      </header>

      <main className="main-content">
        {adminError && <div className="admin-message" role="alert">{adminError}<button onClick={() => setAdminError(null)}>关闭</button></div>}
        {page === 'overview' && <Overview data={overview} orders={overviewOrders} onNavigate={setPage} />}
        {page === 'orders' && <OrdersPage onConfigureRoute={openRouteManager} />}
        {page === 'routes' && <RoutesPage initialStyleId={routeStyleId} />}
        {page === 'bundles' && <BundlesPage bundles={bundleCards} onGenerate={handleGenerateBundles} onRefresh={() => loadLiveData(session.activeFactoryId)} />}
        {page === 'workers' && <WorkersPage data={overview} />}
        {page === 'payroll' && <PayrollPage />}
      </main>
    </div>
  );
}

function Overview({ data, orders, onNavigate }: { data: ProductionOverview | undefined; orders: Order[]; onNavigate: (page: Page) => void }) {
  const processMetrics = data?.processMetrics ?? [];
  const maxProcessQty = Math.max(1, ...processMetrics.map((process) => process.goodQty));
  const activeOrderRows = orders.filter((order) => order.status === 'RELEASED' || order.status === 'IN_PROGRESS').slice(0, 6);
  const overdueOrders = data ? activeOrderRows.filter((order) => Boolean(order.dueDate && order.dueDate < data.date)) : [];
  const metricValue = (value: number | undefined) => value === undefined ? '—' : value.toLocaleString();
  const syncFoot = data ? `更新于 ${new Date(data.calculatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '等待实时数据';
  return <>
    <PageHeading eyebrow={data?.date ?? '实时生产数据'} title="生产总览" subtitle={data ? `当前 ${data.activeOrders} 个订单正在生产，所有指标来自实时生产记录。` : '正在加载当前工厂的生产数据。'}><button className="button secondary" onClick={() => onNavigate('bundles')}>打印扎包卡</button><button className="button primary" onClick={() => onNavigate('orders')}>新建生产订单</button></PageHeading>
    <section className="metrics" aria-label="今日生产指标">
      <Metric featured label="今日完成" value={metricValue(data?.completedQty)} unit="件" foot={syncFoot} />
      <Metric label="生产中订单" value={metricValue(data?.activeOrders)} unit="单" foot="按当前工厂汇总" />
      <Metric label="在制扎包" value={metricValue(data?.activeBundles)} unit="扎" foot={data ? `${data.wipQty.toLocaleString()} 件在制` : '等待实时数据'} />
      <Metric warning={Boolean(data?.blockedBundles)} label="异常待处理" value={metricValue(data?.blockedBundles)} unit="项" foot={data?.blockedBundles ? '存在阻塞扎包' : '当前无阻塞扎包'} />
    </section>
    <section className="dashboard-grid">
      <article className="panel flow-panel"><PanelHead title="今日工序流量" subtitle="各工序实时完成件数" />{processMetrics.length > 0 ? <div className="bar-chart">{processMetrics.map((process) => <div className="bar-column" key={process.processId}><span>{process.goodQty.toLocaleString()}</span><i style={{ height: `${Math.max(8, process.goodQty / maxProcessQty * 100)}%` }} /><b>{process.processName}</b></div>)}</div> : <div className="admin-empty">今天尚无工序报工数据。</div>}</article>
      <article className="panel attention-panel"><PanelHead title="需要关注" subtitle="根据实时订单和扎包状态识别" />
        {data?.blockedBundles ? <Alert tone="danger" title={`${data.blockedBundles} 扎衣服处于阻塞状态`} detail="请在裁床扎包页查看具体记录" time="实时" /> : null}
        {overdueOrders.map((order) => <Alert key={order.id} tone="warning" title={`订单 ${order.orderNo} 已到交期`} detail={`${order.styleCode} · 当前进度 ${Number(order.progressPercent ?? 0).toFixed(1)}%`} time={order.dueDate?.slice(5) ?? ''} />)}
        {!data?.blockedBundles && overdueOrders.length === 0 && <div className="admin-empty">当前没有需要关注的生产异常。</div>}
      </article>
    </section>
    <article className="panel order-panel"><PanelHead title="进行中的订单" subtitle="来自当前工厂的实时订单" action={<button className="text-button" onClick={() => onNavigate('orders')}>查看全部订单</button>} /><OrderTable data={activeOrderRows} /></article>
  </>;
}
function OrdersPage({ onConfigureRoute }: { onConfigureRoute: (styleId: string) => void }) {
  const [orderList, setOrderList] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order>();
  const [releasingOrderId, setReleasingOrderId] = useState<string>();
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string }>();

  async function loadOrders() {
    setLoading(true);
    try {
      const page = await listOrders({ limit: 100 });
      setOrderList(page.items);
    } catch (error) {
      setMessage({ tone: 'error', text: adminErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadOrders(); }, []);

  async function handleRelease(order: Order) {
    setReleasingOrderId(order.id);
    setMessage(undefined);
    try {
      const released = await releaseOrder(order.id);
      setMessage({ tone: 'success', text: `订单 ${released.orderNo} 已下达生产，现在可在裁床扎包中选择。` });
      await loadOrders();
    } catch (error) {
      setMessage({ tone: 'error', text: adminErrorMessage(error) });
    } finally {
      setReleasingOrderId(undefined);
    }
  }

  if (creating || editingOrder) {
    return <NewOrderForm
      existingOrder={editingOrder}
      onCancel={() => { setCreating(false); setEditingOrder(undefined); }}
      onCreated={async (order) => {
        const edited = Boolean(editingOrder);
        setCreating(false);
        setEditingOrder(undefined);
        setMessage({ tone: 'success', text: edited ? `订单 ${order.orderNo} 已保存修改。` : `订单 ${order.orderNo} 已创建为草稿，共 ${order.totalPlannedQty} 件。` });
        await loadOrders();
      }}
    />;
  }

  return <>
    <PageHeading eyebrow="生产计划" title="生产订单" subtitle="管理订单、颜色尺码明细和款式工艺路线。">
      <button className="button secondary">导出</button>
      <button className="button primary" onClick={() => { setMessage(undefined); setEditingOrder(undefined); setCreating(true); }}>新建订单</button>
    </PageHeading>
    {message && <div className={`order-form-message ${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</div>}
    <article className="panel order-panel">
      <PanelHead title="生产订单" subtitle="新订单保存为草稿，发布工艺路线后再放行生产。" />
      {loading ? <p className="admin-empty">正在加载订单…</p> : orderList.length === 0 ? <p className="admin-empty">暂无订单，点击“新建订单”录入第一张生产单。</p> : <OrderTable data={orderList} onEdit={setEditingOrder} onConfigureRoute={onConfigureRoute} onRelease={(order) => void handleRelease(order)} releasingOrderId={releasingOrderId} />}
    </article>
  </>;
}


interface RouteStepDraft {
  key: string;
  processId: string;
  minimumSkillLevel: number;
  pieceRate: string;
  allowedWorkshopId: string;
  isQualityGate: boolean;
  isFinal: boolean;
}

function newRouteStep(process?: MasterDataItem, isFinal = false): RouteStepDraft {
  return {
    key: `${Date.now()}-${Math.random()}`,
    processId: process?.id ?? '',
    minimumSkillLevel: 1,
    pieceRate: process?.defaultPieceRate ?? '0.0000',
    allowedWorkshopId: '',
    isQualityGate: false,
    isFinal,
  };
}

function routeStepDraft(step: RouteVersion['steps'][number]): RouteStepDraft {
  return {
    key: step.id,
    processId: step.processId,
    minimumSkillLevel: step.minimumSkillLevel,
    pieceRate: step.pieceRate ?? '0.0000',
    allowedWorkshopId: step.allowedWorkshopIds?.[0] ?? '',
    isQualityGate: step.isQualityGate,
    isFinal: step.isFinal,
  };
}

function todayDateInput(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function RoutesPage({ initialStyleId }: { initialStyleId?: string | undefined }) {
  const [styles, setStyles] = useState<MasterDataItem[]>([]);
  const [processList, setProcessList] = useState<MasterDataItem[]>([]);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [styleId, setStyleId] = useState(initialStyleId ?? '');
  const [versions, setVersions] = useState<RouteVersion[]>([]);
  const [draftRouteId, setDraftRouteId] = useState<string>();
  const [draftVersion, setDraftVersion] = useState<number>();
  const [steps, setSteps] = useState<RouteStepDraft[]>([]);
  const [effectiveFrom, setEffectiveFrom] = useState(todayDateInput());
  const [reason, setReason] = useState('');
  const [processDraft, setProcessDraft] = useState<{ targetKey: string; code: string; name: string; pieceRate: string }>();
  const [processSaving, setProcessSaving] = useState(false);
  const [processMessage, setProcessMessage] = useState<{ tone: 'success' | 'error'; text: string }>();
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'draft' | 'publish'>();
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string }>();

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([
      listStyles({ limit: 100, status: 'ACTIVE' }),
      listProcesses({ limit: 100, status: 'ACTIVE' }),
      listWorkshops({ limit: 100, status: 'ACTIVE' }),
    ]).then(([stylePage, processPage, workshopPage]) => {
      if (!active) return;
      setStyles(stylePage.items);
      setProcessList(processPage.items);
      setWorkshops(workshopPage.items);
      setStyleId((current) => current || stylePage.items[0]?.id || '');
    }).catch((error: unknown) => {
      if (active) setMessage({ tone: 'error', text: adminErrorMessage(error) });
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (initialStyleId) setStyleId(initialStyleId);
  }, [initialStyleId]);

  useEffect(() => {
    if (!styleId || processList.length === 0) return;
    let active = true;
    setLoading(true);
    setMessage(undefined);
    void listRouteVersions({ styleId, limit: 100 }).then((page) => {
      if (!active) return;
      const nextVersions = [...page.items].sort((left, right) => right.versionNo - left.versionNo);
      setVersions(nextVersions);
      const editable = nextVersions.find((route) => route.status === 'DRAFT');
      const published = nextVersions.find((route) => route.status === 'PUBLISHED');
      const source = editable ?? published;
      setDraftRouteId(editable?.id);
      setDraftVersion(editable?.version);
      setEffectiveFrom(editable?.effectiveFrom ?? todayDateInput());
      setReason('');
      setSteps(source?.steps.length ? source.steps.map(routeStepDraft) : [newRouteStep(processList[0], true)]);
      setEditing(!source);
    }).catch((error: unknown) => {
      if (active) setMessage({ tone: 'error', text: adminErrorMessage(error) });
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [styleId, processList]);

  async function submitProcess() {
    if (!processDraft || processSaving) return;
    if (!processDraft.code.trim() || !processDraft.name.trim()) {
      setProcessMessage({ tone: 'error', text: '请填写工序编码和名称。' });
      return;
    }
    if (!/^\d+(?:\.\d{1,4})?$/.test(processDraft.pieceRate.trim())) {
      setProcessMessage({ tone: 'error', text: '计件单价必须是非负数，最多保留 4 位小数。' });
      return;
    }
    setProcessSaving(true);
    setProcessMessage(undefined);
    try {
      const created = await createProcess({
        code: processDraft.code.trim().toUpperCase(),
        name: processDraft.name.trim(),
        status: 'ACTIVE',
        displayOrder: 0,
        unit: 'PIECE',
        defaultPieceRate: processDraft.pieceRate.trim(),
      });
      setProcessList((current) => [...current.filter((item) => item.id !== created.id), created]);
      updateStep(processDraft.targetKey, {
        processId: created.id,
        pieceRate: created.defaultPieceRate ?? '0.0000',
      });
      setProcessDraft(undefined);
      setProcessMessage({ tone: 'success', text: `工序 ${created.code} · ${created.name} 已创建并选中。` });
    } catch (error) {
      setProcessMessage({ tone: 'error', text: adminErrorMessage(error) });
    } finally {
      setProcessSaving(false);
    }
  }

  function updateStep(key: string, patch: Partial<RouteStepDraft>) {
    setSteps((current) => current.map((step) => step.key === key ? { ...step, ...patch } : step));
    setMessage(undefined);
  }

  function selectFinal(key: string) {
    setSteps((current) => current.map((step) => ({ ...step, isFinal: step.key === key })));
    setMessage(undefined);
  }

  function moveStep(index: number, offset: -1 | 1) {
    setSteps((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function removeStep(key: string) {
    setSteps((current) => {
      if (current.length === 1) return current;
      const next = current.filter((step) => step.key !== key);
      if (!next.some((step) => step.isFinal)) next[next.length - 1] = { ...next[next.length - 1]!, isFinal: true };
      return next;
    });
  }

  function routeInput(): RouteVersionCreate | RouteVersionReplace {
    if (!styleId) throw new Error('请选择款式。');
    if (!effectiveFrom) throw new Error('请选择生效日期。');
    if (steps.length < 1) throw new Error('工艺路线至少需要一个工序。');
    if (steps.some((step) => !step.processId)) throw new Error('请为每个步骤选择标准工序。');
    if (new Set(steps.map((step) => step.processId)).size !== steps.length) throw new Error('同一标准工序不能在路线中重复。');
    if (steps.filter((step) => step.isFinal).length !== 1) throw new Error('请选择且只选择一个最终工序。');
    const normalizedSteps: RouteStepInput[] = steps.map((step, index) => {
      if (!/^\d+(?:\.\d{1,4})?$/.test(step.pieceRate.trim())) throw new Error(`第 ${index + 1} 步计件单价格式不正确。`);
      return {
        stepNo: index + 1,
        processId: step.processId,
        isRequired: true,
        isQualityGate: step.isQualityGate,
        allowParallel: false,
        canSkip: false,
        isFinal: step.isFinal,
        pieceRate: step.pieceRate.trim(),
        allowedWorkshopIds: step.allowedWorkshopId ? [step.allowedWorkshopId] : [],
        minimumSkillLevel: step.minimumSkillLevel,
        prerequisiteStepNos: index === 0 ? [] : [index],
      };
    });
    return draftRouteId
      ? { effectiveFrom, steps: normalizedSteps }
      : { styleId, effectiveFrom, steps: normalizedSteps };
  }

  async function persistDraft(): Promise<RouteVersion> {
    const input = routeInput();
    if (draftRouteId) {
      if (typeof draftVersion !== 'number') throw new Error('路线版本信息缺失，请刷新后重试。');
      return replaceRouteVersion(draftRouteId, draftVersion, input as RouteVersionReplace);
    }
    return createRouteVersion(input as RouteVersionCreate);
  }

  async function reloadRoutes() {
    const page = await listRouteVersions({ styleId, limit: 100 });
    const nextVersions = [...page.items].sort((left, right) => right.versionNo - left.versionNo);
    setVersions(nextVersions);
    return nextVersions;
  }

  async function saveDraft() {
    if (saving) return;
    setSaving('draft');
    setMessage(undefined);
    try {
      const saved = await persistDraft();
      setDraftRouteId(saved.id);
      setDraftVersion(saved.version);
      setSteps(saved.steps.map(routeStepDraft));
      await reloadRoutes();
      setEditing(false);
      setMessage({ tone: 'success', text: `工艺路线 v${saved.versionNo} 已保存为草稿，尚未影响生产。` });
    } catch (error) {
      setMessage({ tone: 'error', text: adminErrorMessage(error) });
    } finally {
      setSaving(undefined);
    }
  }

  async function publishDraft(saveChanges = true) {
    if (saving) return;
    setSaving('publish');
    setMessage(undefined);
    try {
      const saved = saveChanges ? await persistDraft() : versions.find((route) => route.status === 'DRAFT');
      if (!saved) throw new Error('没有可以发布的工艺路线草稿。');
      const published = await publishRouteVersion(saved.id, effectiveFrom, reason.trim() || undefined);
      setDraftRouteId(undefined);
      setDraftVersion(undefined);
      setSteps(published.steps.map(routeStepDraft));
      setReason('');
      await reloadRoutes();
      setEditing(false);
      setMessage({ tone: 'success', text: `工艺路线 v${published.versionNo} 已发布；该款式的草稿订单现在可以下达生产。` });
    } catch (error) {
      setMessage({ tone: 'error', text: adminErrorMessage(error) });
    } finally {
      setSaving(undefined);
    }
  }

  const selectedStyle = styles.find((style) => style.id === styleId);
  const published = versions.find((route) => route.status === 'PUBLISHED');
  const displayRoute = versions.find((route) => route.status === 'DRAFT') ?? published;

  function cancelEditing() {
    if (displayRoute) {
      setDraftRouteId(displayRoute.status === 'DRAFT' ? displayRoute.id : undefined);
      setDraftVersion(displayRoute.status === 'DRAFT' ? displayRoute.version : undefined);
      setEffectiveFrom(displayRoute.effectiveFrom ?? todayDateInput());
      setSteps(displayRoute.steps.map(routeStepDraft));
    }
    setProcessDraft(undefined);
    setProcessMessage(undefined);
    setEditing(false);
  }

  return <>
    <PageHeading eyebrow="主数据 · 版本化工艺" title="工艺路线" subtitle="默认展示已保存路线；需要调整时再进入编辑，新扎包按发布版本生成工序快照。">
      {editing ? <><button className="button secondary" disabled={Boolean(saving)} onClick={cancelEditing}>取消编辑</button><button className="button secondary" disabled={loading || Boolean(saving)} onClick={() => void saveDraft()}>{saving === 'draft' ? '保存中…' : '保存草稿'}</button><button className="button primary" disabled={loading || Boolean(saving)} onClick={() => void publishDraft()}>{saving === 'publish' ? '发布中…' : '发布并启用'}</button></> : <>{displayRoute?.status === 'DRAFT' && <button className="button primary" disabled={Boolean(saving)} onClick={() => void publishDraft(false)}>{saving === 'publish' ? '发布中…' : '发布此草稿'}</button>}<button className={`button ${displayRoute?.status === 'DRAFT' ? 'secondary' : 'primary'}`} disabled={loading} onClick={() => setEditing(true)}>{displayRoute ? displayRoute.status === 'DRAFT' ? '继续编辑草稿' : '新建路线版本' : '创建第一版路线'}</button></>}
    </PageHeading>
    {message && <div className={`order-form-message ${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</div>}
    <section className="route-layout">
      {!editing && displayRoute ? <article className="panel route-view">
        <div className="route-view-head"><label>查看款式<select value={styleId} onChange={(event) => setStyleId(event.target.value)} disabled={loading}>{styles.map((style) => <option key={style.id} value={style.id}>{style.code} · {style.name}</option>)}</select></label><div><span className={`status ${displayRoute.status === 'PUBLISHED' ? 'active' : 'warning'}`}>{routeStatusLabel(displayRoute.status)}</span><strong>版本 v{displayRoute.versionNo}</strong><small>{displayRoute.effectiveFrom ? `${displayRoute.effectiveFrom} 生效` : '尚未设置生效日期'}</small></div></div>
        <div className={`route-view-notice ${displayRoute.status === 'PUBLISHED' ? 'published' : 'draft'}`}><strong>{displayRoute.status === 'PUBLISHED' ? '当前生产版本' : '路线草稿尚未生效'}</strong><span>{displayRoute.status === 'PUBLISHED' ? '以后新生成的扎包将复制此路线；已有扎包继续保留原工艺快照。' : '检查工序顺序后点击“发布此草稿”，订单才可使用该版本生产。'}</span></div>
        <div className="route-view-title"><div><h2>{selectedStyle?.code} · {selectedStyle?.name}</h2><p>{displayRoute.steps.length} 道工序，按以下顺序执行</p></div></div>
        <div className="route-flow-view">{displayRoute.steps.map((step, index) => { const workshopNames = (step.allowedWorkshopIds ?? []).map((id) => workshops.find((workshop) => workshop.id === id)?.name).filter(Boolean); return <article className={step.isFinal ? 'final' : ''} key={step.id}><div className="route-flow-index"><b>{String(step.stepNo).padStart(2, '0')}</b><span>{index === 0 ? '起始' : `前置 ${step.prerequisiteStepNos?.join('、') || index}`}</span></div><div><strong>{step.processName}</strong><small>{step.processCode}</small></div><dl><div><dt>最低技能</dt><dd>L{step.minimumSkillLevel}</dd></div><div><dt>计件单价</dt><dd>¥{Number(step.pieceRate ?? 0).toFixed(4)}</dd></div><div><dt>生产车间</dt><dd>{workshopNames.length ? workshopNames.join('、') : '不限车间'}</dd></div></dl><div className="route-flow-tags">{step.isQualityGate && <span>质检点</span>}{step.isFinal && <span>最终工序</span>}</div></article>; })}</div>
      </article> : !editing ? <article className="panel route-view-empty"><strong>该款式还没有工艺路线</strong><span>点击“创建第一版路线”，配置工序并发布后才能下达生产订单。</span><button className="button primary" onClick={() => setEditing(true)}>创建第一版路线</button></article> : <article className="panel route-editor">
        <div className="skill-manager-head"><div><h2>{draftRouteId ? '编辑路线草稿' : published ? '基于已发布路线创建新版本' : '创建第一版工艺路线'}</h2><p>步骤按顺序执行；后一步默认以前一步完成为前置条件。</p></div><span>{draftRouteId ? '草稿' : published ? `当前 v${published.versionNo}` : '未发布'}</span></div>
        <div className="route-meta-grid">
          <label>款式 <em>必填</em><select value={styleId} onChange={(event) => setStyleId(event.target.value)} disabled={loading || Boolean(saving)}>{styles.length === 0 && <option value="">暂无可用款式</option>}{styles.map((style) => <option key={style.id} value={style.id}>{style.code} · {style.name}</option>)}</select></label>
          <label>生效日期 <em>必填</em><input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></label>
          <label>发布说明 <small>选填</small><input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="例如：首版量产工艺" /></label>
        </div>
        <div className="route-step-heading"><div><strong>{selectedStyle?.code ?? '款式'} 的工序步骤</strong><p>设置技能等级、计件单价、车间和唯一最终工序。</p></div><button className="button secondary" onClick={() => setSteps((current) => [...current, newRouteStep(processList.find((process) => !current.some((step) => step.processId === process.id)), current.length === 0)])}>添加工序</button></div>
        {processMessage && <div className={`process-create-message ${processMessage.tone}`} role={processMessage.tone === 'error' ? 'alert' : 'status'}>{processMessage.text}</div>}
        {processDraft && <div className="process-create-card"><div><strong>自定义标准工序</strong><span>保存后自动选中当前路线步骤，也可用于员工技能分配。</span></div><label>工序编码 <em>必填</em><input autoFocus value={processDraft.code} maxLength={60} onChange={(event) => setProcessDraft({ ...processDraft, code: event.target.value })} placeholder="例如 CUT" /></label><label>工序名称 <em>必填</em><input value={processDraft.name} maxLength={120} onChange={(event) => setProcessDraft({ ...processDraft, name: event.target.value })} placeholder="例如 裁片" /></label><label>计件单价 <em>必填</em><input type="text" inputMode="decimal" value={processDraft.pieceRate} onChange={(event) => setProcessDraft({ ...processDraft, pieceRate: event.target.value })} /></label><div><button className="button secondary" disabled={processSaving} onClick={() => setProcessDraft(undefined)}>取消</button><button className="button primary" disabled={processSaving} onClick={() => void submitProcess()}>{processSaving ? '创建中…' : '创建并选中'}</button></div></div>}
        <div className="route-step-list">
          {loading ? <p className="skill-empty">正在加载工艺路线…</p> : steps.map((step, index) => <article className={`route-step-row ${step.isFinal ? 'final' : ''}`} key={step.key}>
            <div className="route-step-number"><b>{String(index + 1).padStart(2, '0')}</b><span>{index === 0 ? '起始' : `前置 ${index}`}</span></div>
            <div className="route-step-fields">
              <label>标准工序<select value={step.processId} onChange={(event) => { if (event.target.value === '__custom_process__') { setProcessDraft({ targetKey: step.key, code: '', name: '', pieceRate: '0.0000' }); setProcessMessage(undefined); return; } const process = processList.find((item) => item.id === event.target.value); updateStep(step.key, { processId: event.target.value, pieceRate: process?.defaultPieceRate ?? step.pieceRate }); }}><option value="">请选择工序</option>{processList.map((process) => <option key={process.id} value={process.id} disabled={steps.some((item) => item.key !== step.key && item.processId === process.id)}>{process.code} · {process.name}</option>)}<option value="__custom_process__">＋ 自定义工序</option></select></label>
              <label>最低技能<select value={step.minimumSkillLevel} onChange={(event) => updateStep(step.key, { minimumSkillLevel: Number(event.target.value) })}>{[1, 2, 3, 4, 5].map((level) => <option value={level} key={level}>L{level}</option>)}</select></label>
              <label>计件单价<input type="text" inputMode="decimal" value={step.pieceRate} onChange={(event) => updateStep(step.key, { pieceRate: event.target.value })} /></label>
              <label>限定车间<select value={step.allowedWorkshopId} onChange={(event) => updateStep(step.key, { allowedWorkshopId: event.target.value })}><option value="">不限车间</option>{workshops.map((workshop) => <option value={workshop.id} key={workshop.id}>{workshop.code} · {workshop.name}</option>)}</select></label>
            </div>
            <div className="route-step-options">
              <label><input type="checkbox" checked={step.isQualityGate} onChange={(event) => updateStep(step.key, { isQualityGate: event.target.checked })} />质检点</label>
              <label><input type="radio" name="final-route-step" checked={step.isFinal} onChange={() => selectFinal(step.key)} />最终工序</label>
              <div><button className="route-icon-button" disabled={index === 0} onClick={() => moveStep(index, -1)} aria-label={`上移第 ${index + 1} 步`}>↑</button><button className="route-icon-button" disabled={index === steps.length - 1} onClick={() => moveStep(index, 1)} aria-label={`下移第 ${index + 1} 步`}>↓</button><button className="route-remove-button" disabled={steps.length === 1} onClick={() => removeStep(step.key)}>移除</button></div>
            </div>
          </article>)}
        </div>
        <div className="route-editor-footer"><span>发布后新生成的扎包会快照保存此版本；历史扎包不受影响。</span><div><button className="button secondary" disabled={loading || Boolean(saving)} onClick={() => void saveDraft()}>保存草稿</button><button className="button primary" disabled={loading || Boolean(saving)} onClick={() => void publishDraft()}>发布并启用</button></div></div>
      </article>}
      <aside className="panel route-history">
        <div className="skill-manager-head"><div><h2>版本记录</h2><p>已发布版本不可修改，新调整会创建更高版本。</p></div><span>{versions.length} 个版本</span></div>
        {versions.length === 0 ? <p className="skill-empty">该款式还没有路线版本。</p> : versions.map((route) => <article key={route.id}><div><strong>v{route.versionNo}</strong><span className={`status ${route.status === 'PUBLISHED' ? 'active' : route.status === 'DRAFT' ? 'warning' : 'neutral'}`}>{routeStatusLabel(route.status)}</span></div><p>{route.steps.map((step) => step.processName).join(' → ') || '暂无工序'}</p><small>{route.effectiveFrom ? `${route.effectiveFrom} 生效` : '尚未设置生效日期'} · {route.steps.length} 个工序</small></article>)}
      </aside>
    </section>
  </>;
}

function routeStatusLabel(status: string): string {
  return ({ DRAFT: '草稿', PUBLISHED: '已发布', RETIRED: '已停用' } as Record<string, string>)[status] ?? status;
}

interface OrderLineDraft {
  key: string;
  colorId: string;
  sizeId: string;
  dyeLotNo: string;
  plannedQty: string;
  overproductionLimit: string;
}

function newOrderLine(colorId = '', sizeId = ''): OrderLineDraft {
  return {
    key: `${Date.now()}-${Math.random()}`,
    colorId,
    sizeId,
    dyeLotNo: '',
    plannedQty: '',
    overproductionLimit: '0',
  };
}

function NewOrderForm({ existingOrder, onCancel, onCreated }: {
  existingOrder?: Order | undefined;
  onCancel: () => void;
  onCreated: (order: Order) => Promise<void>;
}) {
  const [customers, setCustomers] = useState<MasterDataItem[]>([]);
  const [styles, setStyles] = useState<MasterDataItem[]>([]);
  const [colors, setColors] = useState<MasterDataItem[]>([]);
  const [sizes, setSizes] = useState<MasterDataItem[]>([]);
  const [orderNo, setOrderNo] = useState(existingOrder?.orderNo ?? '');
  const [customerId, setCustomerId] = useState(existingOrder?.customerId ?? '');
  const [styleId, setStyleId] = useState(existingOrder?.styleId ?? '');
  const [plannedStartDate, setPlannedStartDate] = useState(existingOrder?.plannedStartDate ?? '');
  const [dueDate, setDueDate] = useState(existingOrder?.dueDate ?? '');
  const [externalRef, setExternalRef] = useState(existingOrder?.externalRef ?? '');
  const [notes, setNotes] = useState(existingOrder?.notes ?? '');
  const [lines, setLines] = useState<OrderLineDraft[]>(() => existingOrder ? existingOrder.items.map((item) => ({ key: item.id, colorId: item.colorId, sizeId: item.sizeId, dyeLotNo: item.dyeLotNo ?? '', plannedQty: String(item.plannedQty), overproductionLimit: String(item.overproductionLimit) })) : [newOrderLine()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [creatingStyle, setCreatingStyle] = useState(false);
  const [styleDraft, setStyleDraft] = useState({ code: '', name: '', customerStyleNo: '', versionName: '' });
  const [styleMessage, setStyleMessage] = useState<{ tone: 'success' | 'error'; text: string }>();
  const [variantDraft, setVariantDraft] = useState<{ kind: 'color' | 'size'; targetKey: string; code: string; name: string }>();
  const [variantSaving, setVariantSaving] = useState(false);
  const [variantMessage, setVariantMessage] = useState<{ tone: 'success' | 'error'; text: string }>();

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([
      listCustomers({ limit: 200, status: 'ACTIVE' }),
      listStyles({ limit: 200, status: 'ACTIVE' }),
      listColors({ limit: 200, status: 'ACTIVE' }),
      listSizes({ limit: 200, status: 'ACTIVE' }),
    ]).then(([customerPage, stylePage, colorPage, sizePage]) => {
      if (!active) return;
      setCustomers(customerPage.items);
      setStyles(stylePage.items);
      setColors(colorPage.items);
      setSizes(sizePage.items);
      if (!existingOrder) setLines([newOrderLine(colorPage.items[0]?.id, sizePage.items[0]?.id)]);
    }).catch((error: unknown) => {
      if (active) setMessage(adminErrorMessage(error));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const availableStyles = customerId
    ? styles.filter((style) => !style.customerId || style.customerId === customerId)
    : styles;
  const totalQty = lines.reduce((total, line) => total + (Number(line.plannedQty) || 0), 0);

  function updateLine(key: string, patch: Partial<OrderLineDraft>) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
    setMessage(undefined);
  }

  function addLine() {
    setLines((current) => [...current, newOrderLine(colors[0]?.id, sizes[0]?.id)]);
  }

  async function submitStyle() {
    if (!styleDraft.code.trim() || !styleDraft.name.trim()) return setStyleMessage({ tone: 'error', text: '请填写款号和款式名称。' });
    setStyleMessage(undefined);
    try {
      const created = await createStyle({
        code: styleDraft.code.trim().toUpperCase(), name: styleDraft.name.trim(), status: 'ACTIVE',
        customerId: customerId || null, customerStyleNo: styleDraft.customerStyleNo.trim() || null,
        versionName: styleDraft.versionName.trim() || null, displayOrder: 0,
      });
      setStyles((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setStyleId(created.id);
      if (created.customerId) setCustomerId(created.customerId);
      setCreatingStyle(false);
      setStyleDraft({ code: '', name: '', customerStyleNo: '', versionName: '' });
      setStyleMessage({ tone: 'success', text: `款式 ${created.code} 已创建并选中。` });
    } catch (error) { setStyleMessage({ tone: 'error', text: adminErrorMessage(error) }); }
  }

  function requestVariant(kind: 'color' | 'size', targetKey: string) {
    setVariantDraft({ kind, targetKey, code: '', name: '' });
    setVariantMessage(undefined);
  }

  async function submitVariant() {
    if (!variantDraft || variantSaving) return;
    if (!variantDraft.code.trim() || !variantDraft.name.trim()) {
      setVariantMessage({ tone: 'error', text: `请填写${variantDraft.kind === 'color' ? '颜色' : '尺码'}编码和名称。` });
      return;
    }
    setVariantSaving(true);
    setVariantMessage(undefined);
    try {
      const input = {
        code: variantDraft.code.trim().toUpperCase(),
        name: variantDraft.name.trim(),
        status: 'ACTIVE' as const,
        displayOrder: variantDraft.kind === 'color' ? colors.length : sizes.length,
      };
      const created = variantDraft.kind === 'color' ? await createColor(input) : await createSize(input);
      if (variantDraft.kind === 'color') {
        setColors((current) => [...current.filter((item) => item.id !== created.id), created]);
        updateLine(variantDraft.targetKey, { colorId: created.id });
      } else {
        setSizes((current) => [...current.filter((item) => item.id !== created.id), created]);
        updateLine(variantDraft.targetKey, { sizeId: created.id });
      }
      setVariantMessage({ tone: 'success', text: `${variantDraft.kind === 'color' ? '颜色' : '尺码'} ${created.code} · ${created.name} 已创建并选中。` });
      setVariantDraft(undefined);
    } catch (error) {
      setVariantMessage({ tone: 'error', text: adminErrorMessage(error) });
    } finally {
      setVariantSaving(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setMessage(undefined);
    if (!orderNo.trim()) return setMessage('请输入订单号。');
    if (!styleId) return setMessage('请选择款式。');
    if (plannedStartDate && dueDate && dueDate < plannedStartDate) return setMessage('交期不能早于计划开工日期。');
    if (lines.some((line) => !line.colorId || !line.sizeId || !/^\d+$/.test(line.plannedQty) || Number(line.plannedQty) < 1)) {
      return setMessage('每条明细都必须选择颜色、尺码，并填写大于 0 的计划数量。');
    }
    if (lines.some((line) => !/^\d+$/.test(line.overproductionLimit) || Number(line.overproductionLimit) < 0)) {
      return setMessage('超投上限必须是大于或等于 0 的整数。');
    }
    const combinations = lines.map((line) => `${line.colorId}:${line.sizeId}:${line.dyeLotNo.trim()}`);
    if (new Set(combinations).size !== combinations.length) return setMessage('颜色、尺码和缸号完全相同的明细不能重复。');

    const items: OrderItemInput[] = lines.map((line, index) => ({
      lineNo: index + 1,
      colorId: line.colorId,
      sizeId: line.sizeId,
      dyeLotNo: line.dyeLotNo.trim() || null,
      plannedQty: Number(line.plannedQty),
      overproductionLimit: Number(line.overproductionLimit),
    }));
    const editable: OrderPatch = {
      customerId: customerId || null,
      styleId,
      plannedStartDate: plannedStartDate || null,
      dueDate: dueDate || null,
      externalRef: externalRef.trim() || null,
      notes: notes.trim() || null,
      items,
    };
    setSaving(true);
    try {
      let saved: Order;
      if (existingOrder) {
        if (typeof existingOrder.version !== 'number') throw new Error('订单版本信息缺失，请刷新后重试。');
        saved = await updateOrder(existingOrder.id, existingOrder.version, editable);
      } else {
        const input: OrderCreate = { orderNo: orderNo.trim(), ...editable, styleId, items };
        saved = await createOrder(input);
      }
      await onCreated(saved);
    } catch (error) {
      setMessage(adminErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return <form className="order-create-page" onSubmit={(event) => void submit(event)}>
    <PageHeading eyebrow={existingOrder ? '生产计划 · 编辑订单' : '生产计划 · 新建订单'} title={existingOrder ? `编辑订单 ${existingOrder.orderNo}` : '录入生产订单'} subtitle={existingOrder ? '仅草稿订单可以修改；保存后仍保持草稿状态。' : '先保存草稿；检查颜色尺码明细和工艺路线后再下达生产。'}>
      <button type="button" className="button secondary" onClick={onCancel} disabled={saving}>取消</button>
      <button type="submit" className="button primary" disabled={loading || saving}>{saving ? '正在保存…' : existingOrder ? '保存修改' : '保存草稿'}</button>
    </PageHeading>
    {message && <div className="order-form-message error" role="alert">{message}</div>}
    <section className="panel order-form-section" aria-labelledby="order-basic-title">
      <div className="order-form-section-head"><div><span>01</span><div><h2 id="order-basic-title">订单基础信息</h2><p>订单号和款式必填，客户与日期可稍后补充。</p></div></div><strong>草稿</strong></div>
      <div className="order-basic-grid">
        <label>订单号 <em>必填</em><input value={orderNo} maxLength={60} onChange={(event) => setOrderNo(event.target.value.toUpperCase())} placeholder="例如 PO-260901" required autoFocus={!existingOrder} disabled={Boolean(existingOrder)} /></label>
        <label>客户<select value={customerId} onChange={(event) => { const next = event.target.value; setCustomerId(next); if (styleId && !styles.some((style) => style.id === styleId && (!next || !style.customerId || style.customerId === next))) setStyleId(''); }} disabled={loading}><option value="">不指定客户</option>{customers.map((customer) => <option value={customer.id} key={customer.id}>{customer.code} · {customer.name}</option>)}</select></label>
        <div className="style-picker-field"><label>款式 <em>必填</em><select value={styleId} onChange={(event) => setStyleId(event.target.value)} disabled={loading} required><option value="">请选择款式</option>{availableStyles.map((style) => <option value={style.id} key={style.id}>{style.code} · {style.name}</option>)}</select></label><button type="button" className="text-button" onClick={() => setCreatingStyle((value) => !value)}>＋ 新建款式</button></div>
        <label>外部单号<input value={externalRef} maxLength={100} onChange={(event) => setExternalRef(event.target.value)} placeholder="客户 PO / ERP 单号" /></label>
        <label>计划开工<input type="date" value={plannedStartDate} onChange={(event) => setPlannedStartDate(event.target.value)} /></label>
        <label>交期<input type="date" value={dueDate} min={plannedStartDate || undefined} onChange={(event) => setDueDate(event.target.value)} /></label>
      </div>
      {styleMessage && <div className={`style-create-message ${styleMessage.tone}`} role={styleMessage.tone === 'error' ? 'alert' : 'status'}>{styleMessage.text}</div>}
      {creatingStyle && <div className="style-create-card"><div><strong>新建款式基础资料</strong><span>创建后将自动选中，不会提交当前订单。</span></div><div className="style-create-grid"><label>款号 <em>必填</em><input value={styleDraft.code} maxLength={60} onChange={(event) => setStyleDraft({ ...styleDraft, code: event.target.value })} /></label><label>名称 <em>必填</em><input value={styleDraft.name} maxLength={120} onChange={(event) => setStyleDraft({ ...styleDraft, name: event.target.value })} /></label><label>客户款号<input value={styleDraft.customerStyleNo} maxLength={100} onChange={(event) => setStyleDraft({ ...styleDraft, customerStyleNo: event.target.value })} /></label><label>版本<input value={styleDraft.versionName} maxLength={40} onChange={(event) => setStyleDraft({ ...styleDraft, versionName: event.target.value })} /></label></div><div className="style-create-actions"><button type="button" className="button secondary" onClick={() => setCreatingStyle(false)}>取消</button><button type="button" className="button primary" onClick={() => void submitStyle()}>创建并选中</button></div></div>}
      <label className="order-notes-field">备注<textarea value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} placeholder="面辅料、包装或交付要求（选填）" /></label>
    </section>
    <section className="panel order-form-section" aria-labelledby="order-lines-title">
      <div className="order-form-section-head"><div><span>02</span><div><h2 id="order-lines-title">颜色尺码明细</h2><p>每行代表一个生产明细；行号会按当前顺序自动生成。</p></div></div><strong>{lines.length} 条 · {totalQty.toLocaleString()} 件</strong></div>
      {loading ? <p className="admin-empty">正在加载颜色与尺码…</p> : colors.length === 0 || sizes.length === 0 ? <p className="admin-empty">缺少启用的颜色或尺码，请先维护基础资料。</p> : <>
        <div className="order-line-table" role="table" aria-label="订单颜色尺码明细">
          <div className="order-line-head" role="row"><span>行号</span><span>颜色</span><span>尺码</span><span>缸号</span><span>计划数量</span><span>超投上限</span><span>操作</span></div>
          {lines.map((line, index) => <div className="order-line-row" role="row" key={line.key}>
            <b><small>行号</small>{String(index + 1).padStart(2, '0')}</b>
            <label><small>颜色</small><select aria-label={`第 ${index + 1} 行颜色`} value={line.colorId} onChange={(event) => event.target.value === '__custom_color__' ? requestVariant('color', line.key) : updateLine(line.key, { colorId: event.target.value })}>{colors.map((color) => <option value={color.id} key={color.id}>{color.code} · {color.name}</option>)}<option value="__custom_color__">＋ 自定义颜色</option></select></label>
            <label><small>尺码</small><select aria-label={`第 ${index + 1} 行尺码`} value={line.sizeId} onChange={(event) => event.target.value === '__custom_size__' ? requestVariant('size', line.key) : updateLine(line.key, { sizeId: event.target.value })}>{sizes.map((size) => <option value={size.id} key={size.id}>{size.code} · {size.name}</option>)}<option value="__custom_size__">＋ 自定义尺码</option></select></label>
            <label><small>缸号</small><input aria-label={`第 ${index + 1} 行缸号`} value={line.dyeLotNo} maxLength={60} onChange={(event) => updateLine(line.key, { dyeLotNo: event.target.value })} placeholder="选填" /></label>
            <label><small>计划数量</small><input aria-label={`第 ${index + 1} 行计划数量`} type="number" inputMode="numeric" min="1" step="1" value={line.plannedQty} onChange={(event) => updateLine(line.key, { plannedQty: event.target.value })} placeholder="0" required /></label>
            <label><small>超投上限</small><input aria-label={`第 ${index + 1} 行超投上限`} type="number" inputMode="numeric" min="0" step="1" value={line.overproductionLimit} onChange={(event) => updateLine(line.key, { overproductionLimit: event.target.value })} required /></label>
            <button type="button" className="line-remove" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}>移除</button>
          </div>)}
        </div>
        {variantMessage && <div className={`variant-create-message ${variantMessage.tone}`} role={variantMessage.tone === 'error' ? 'alert' : 'status'}>{variantMessage.text}</div>}
        {variantDraft && <div className="variant-create-card"><div><strong>自定义{variantDraft.kind === 'color' ? '颜色' : '尺码'}</strong><span>保存为正式基础资料，并自动选中当前明细行。</span></div><label>编码 <em>必填</em><input autoFocus value={variantDraft.code} maxLength={60} onChange={(event) => setVariantDraft({ ...variantDraft, code: event.target.value })} placeholder={variantDraft.kind === 'color' ? '例如 RED' : '例如 XL'} /></label><label>名称 <em>必填</em><input value={variantDraft.name} maxLength={120} onChange={(event) => setVariantDraft({ ...variantDraft, name: event.target.value })} placeholder={variantDraft.kind === 'color' ? '例如 红色' : '例如 加大码'} /></label><div><button type="button" className="button secondary" disabled={variantSaving} onClick={() => setVariantDraft(undefined)}>取消</button><button type="button" className="button primary" disabled={variantSaving} onClick={() => void submitVariant()}>{variantSaving ? '创建中…' : '创建并选中'}</button></div></div>}
        <button type="button" className="add-order-line" onClick={addLine}>＋ 添加颜色尺码明细</button>
      </>}
    </section>
    <footer className="order-form-footer"><span>{existingOrder ? '保存修改后仍为草稿；下达生产前可继续编辑。' : '保存后状态为“草稿”，不会自动生成裁床或扎包。'}</span><div><b>计划合计：{totalQty.toLocaleString()} 件</b><button type="button" className="button secondary" onClick={onCancel} disabled={saving}>取消</button><button className="button primary" disabled={loading || saving || colors.length === 0 || sizes.length === 0}>{saving ? '正在保存…' : existingOrder ? '保存修改' : '保存草稿'}</button></div></footer>
  </form>;
}

interface CuttingBedSummary {
  id: string;
  bedNo: string;
  orderNo: string;
  styleLabel: string;
  variants: string[];
  totalQty: number;
  bundleCount: number;
  completedCount: number;
}

interface OrderBundleSummary {
  orderId: string;
  orderNo: string;
  styleLabel: string;
  totalQty: number;
  bundleCount: number;
  completedCount: number;
  ready: boolean;
}

function cuttingBedSummaries(bundles: BundleCardData[]): CuttingBedSummary[] {
  const groups = new Map<string, CuttingBedSummary & { variantSet: Set<string> }>();
  for (const bundle of bundles) {
    if (!bundle.id || !bundle.cuttingBedId) continue;
    const current = groups.get(bundle.cuttingBedId) ?? {
      id: bundle.cuttingBedId,
      bedNo: bundle.bedNo ?? '未记录',
      orderNo: bundle.orderNo ?? '未记录',
      styleLabel: bundle.styleLabel ?? '未记录款式',
      variants: [],
      variantSet: new Set<string>(),
      totalQty: 0,
      bundleCount: 0,
      completedCount: 0,
    };
    if (bundle.colorSizeLabel) current.variantSet.add(bundle.colorSizeLabel);
    current.totalQty += bundle.effectiveQty ?? 0;
    current.bundleCount += 1;
    if (bundle.status === '已完成') current.completedCount += 1;
    groups.set(bundle.cuttingBedId, current);
  }
  return [...groups.values()].map(({ variantSet, ...summary }) => ({
    ...summary,
    variants: [...variantSet],
  })).sort((left, right) => left.bedNo.localeCompare(right.bedNo, 'zh-CN', { numeric: true }));
}

function orderBundleSummaries(bundles: BundleCardData[]): OrderBundleSummary[] {
  const groups = new Map<string, OrderBundleSummary>();
  for (const bundle of bundles) {
    if (!bundle.id || !bundle.orderId || ['CANCELLED', 'SPLIT', 'MERGED'].includes(bundle.statusCode)) continue;
    const current = groups.get(bundle.orderId) ?? {
      orderId: bundle.orderId,
      orderNo: bundle.orderNo ?? '未记录',
      styleLabel: bundle.styleLabel ?? '未记录款式',
      totalQty: 0,
      bundleCount: 0,
      completedCount: 0,
      ready: false,
    };
    current.totalQty += bundle.effectiveQty ?? 0;
    current.bundleCount += 1;
    if (bundle.statusCode === 'COMPLETED') current.completedCount += 1;
    current.ready = current.bundleCount > 0 && current.completedCount === current.bundleCount;
    groups.set(bundle.orderId, current);
  }
  return [...groups.values()].sort((left, right) => left.orderNo.localeCompare(right.orderNo, 'zh-CN', { numeric: true }));
}

function BundlesPage({ bundles, onGenerate, onRefresh }: {
  bundles: BundleCardData[];
  onGenerate: (source: BundleGenerationSource) => Promise<BundleGenerationResult>;
  onRefresh: () => Promise<void>;
}) {
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [selectedBundleNos, setSelectedBundleNos] = useState<Set<string>>(() => new Set(bundles[0] ? [bundles[0].no] : []));
  const [generating, setGenerating] = useState(false);
  const [generationMessage, setGenerationMessage] = useState<{ tone: 'success' | 'error'; text: string }>();
  const [selectedBedId, setSelectedBedId] = useState<string>();
  const [timelineBundle, setTimelineBundle] = useState<BundleCardData>();
  const [timelineEvents, setTimelineEvents] = useState<BundleEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string>();
  const [exportingOrderId, setExportingOrderId] = useState<string>();
  const generationSource = bundles.find((bundle) => bundle.generationSource)?.generationSource;
  const orderSummaries = orderBundleSummaries(bundles);
  const bedSummaries = cuttingBedSummaries(bundles);
  const visibleBundles = selectedBedId ? bundles.filter((bundle) => bundle.cuttingBedId === selectedBedId) : bundles;

  useEffect(() => {
    if (selectedBedId && !bedSummaries.some((bed) => bed.id === selectedBedId)) setSelectedBedId(undefined);
  }, [selectedBedId, bedSummaries]);

  async function showTimeline(bundle: BundleCardData) {
    setTimelineBundle(bundle);
    setTimelineEvents([]);
    setTimelineError(undefined);
    if (!bundle.id) {
      setTimelineError('该卡片是静态占位数据，没有可查询的流转记录。');
      return;
    }
    setTimelineLoading(true);
    try {
      const result = await getBundleTimeline(bundle.id);
      setTimelineEvents(result.items);
    } catch (error) {
      setTimelineError(adminErrorMessage(error));
    } finally {
      setTimelineLoading(false);
    }
  }

  async function exportOrderDetails(order: OrderBundleSummary) {
    if (!order.ready || exportingOrderId) return;
    setExportingOrderId(order.orderId);
    setGenerationMessage(undefined);
    try {
      const detail = await getOrderBundleWorkDetails(order.orderId);
      const headers = ['扎包号', '床号', '订单号', '款号', '款式', '颜色', '尺码', '缸号', '路线版本', '工序序号', '工艺编码', '工艺名称', '员工工号', '员工姓名', '执行状态', '开工时间', '完工时间', '投入数量', '良品数量', '次品数量', '短缺数量', '计件单价', '计件金额', '备注'];
      const rows = detail.bundles.flatMap((bundleDetail) => bundleDetail.rows.map((row) => [
        bundleDetail.bundle.bundleNo, bundleDetail.bundle.bedNo, bundleDetail.bundle.orderNo,
        bundleDetail.bundle.styleCode, bundleDetail.bundle.styleName ?? '', bundleDetail.bundle.colorName,
        bundleDetail.bundle.sizeName, bundleDetail.bundle.dyeLotNo ?? '', `v${bundleDetail.bundle.routeVersionNo}`,
        row.stepNo, row.processCode, row.processName, row.workerNo ?? '', row.workerName ?? '',
        exportWorkStatus(row.status), exportDateTime(row.startedAt), exportDateTime(row.completedAt), row.inputQty,
        row.goodQty, row.defectQty, row.missingQty, row.unitRate, row.amount, row.notes ?? '',
      ]));
      const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `订单-${safeFileName(detail.order.orderNo)}-扎包执行明细.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setGenerationMessage({ tone: 'success', text: `订单 ${detail.order.orderNo} 共 ${detail.order.bundleCount} 扎执行明细已统一导出。` });
    } catch (error) {
      setGenerationMessage({ tone: 'error', text: adminErrorMessage(error) });
    } finally {
      setExportingOrderId(undefined);
    }
  }

  function toggleBundle(bundleNo: string, selected: boolean) {
    setSelectedBundleNos((current) => {
      const next = new Set(current);
      if (selected) next.add(bundleNo);
      else next.delete(bundleNo);
      return next;
    });
  }

  async function handleGenerate() {
    if (!generationSource || generating) return;
    setGenerating(true);
    setGenerationMessage(undefined);
    try {
      const result = await onGenerate(generationSource);
      setGenerationMessage({
        tone: 'success',
        text: `已生成 ${result.bundleCount} 扎、共 ${result.totalQty} 件，二维码卡片已刷新。`,
      });
    } catch (error) {
      setGenerationMessage({ tone: 'error', text: adminErrorMessage(error) });
    } finally {
      setGenerating(false);
    }
  }

  return <>
    <PageHeading eyebrow="裁床与流转" title="裁床扎包" subtitle="从已下达订单新增裁床产品，生成“一扎一码”卡片并追踪工序。">
      <button className={`button ${creatingProduct ? 'secondary' : 'primary'}`} onClick={() => setCreatingProduct((value) => !value)}>{creatingProduct ? '关闭新增产品' : '＋ 新增裁床产品'}</button>
      <button className="button secondary" disabled={selectedBundleNos.size === 0} onClick={() => window.print()}>
        打印所选卡片{selectedBundleNos.size > 0 ? ` (${selectedBundleNos.size})` : ''}
      </button>
      <button
        className="button primary"
        disabled={generating || !generationSource}
        onClick={() => void handleGenerate()}
        title={generationSource ? '按每扎 4 件生成或追加该裁床剩余数量' : '当前没有可用于生成的真实裁床数据'}
      >
        {generating ? '生成中…' : bundles.some((bundle) => bundle.id) ? '追加扎包' : '生成扎包'}
      </button>
    </PageHeading>
    {generationMessage && <div className={`bundle-generation-message ${generationMessage.tone}`} role={generationMessage.tone === 'error' ? 'alert' : 'status'}>{generationMessage.text}</div>}
    {creatingProduct && <NewCuttingProductPanel existingBedNos={bedSummaries.map((bed) => bed.bedNo)} onCreated={async (result) => { setCreatingProduct(false); setGenerationMessage({ tone: 'success', text: `新产品已生成 ${result.bundleCount} 扎、共 ${result.totalQty} 件。` }); await onRefresh(); }} />}
    {orderSummaries.length > 0 && <section className="order-export-overview" aria-label="订单统一导出">
      <div className="order-export-head"><div><h2>订单统一导出</h2><p>整张订单的有效扎包全部完成后，一次导出所有员工、工艺、数量和计件金额。</p></div></div>
      <div className="order-export-list">{orderSummaries.map((order) => <article className={`order-export-card ${order.ready ? 'ready' : ''}`} key={order.orderId}>
        <header><div><small>生产订单</small><strong>{order.orderNo}</strong></div><span className={`status ${order.ready ? 'active' : 'warning'}`}>{order.ready ? '全部完成' : `${order.bundleCount - order.completedCount} 扎待完成`}</span></header>
        <p>{order.styleLabel}</p>
        <footer><div><b>{order.completedCount} / {order.bundleCount} 扎</b><span>{order.totalQty.toLocaleString()} 件</span></div><button className={`button ${order.ready ? 'primary' : 'secondary'}`} disabled={!order.ready || exportingOrderId !== undefined} onClick={() => void exportOrderDetails(order)}>{exportingOrderId === order.orderId ? '导出中…' : order.ready ? '统一导出订单明细' : '完成后可导出'}</button></footer>
      </article>)}</div>
    </section>}
    <section className="cutting-bed-overview" aria-label="真实裁床批次">
      <div className="cutting-bed-overview-head"><div><h2>裁床批次</h2><p>按真实床号、订单和颜色尺码聚合；点击批次筛选下方扎包。</p></div>{bedSummaries.length > 0 && <button className={`bed-filter-all ${selectedBedId ? '' : 'active'}`} onClick={() => setSelectedBedId(undefined)}>全部批次 · {bedSummaries.length}</button>}</div>
      {bedSummaries.length === 0 ? <div className="cutting-bed-empty"><strong>暂无真实裁床扎包</strong><span>请先点击“新增裁床产品”，从已下达订单创建裁床并生成扎包。</span></div> : <div className="cutting-bed-list">{bedSummaries.map((bed) => <button className={`cutting-bed-card ${selectedBedId === bed.id ? 'selected' : ''}`} key={bed.id} onClick={() => setSelectedBedId((current) => current === bed.id ? undefined : bed.id)}><div><strong>床号 {bed.bedNo}</strong><span className={`status ${bed.completedCount === bed.bundleCount ? 'active' : 'warning'}`}>{bed.completedCount === bed.bundleCount ? '全部完成' : `${bed.bundleCount - bed.completedCount} 扎待完成`}</span></div><p>订单 {bed.orderNo} · {bed.styleLabel}</p><small>{bed.variants.join('、') || '未记录颜色尺码'}</small><footer><b>{bed.totalQty.toLocaleString()} 件</b><span>{bed.bundleCount} 扎</span><span>已完成 {bed.completedCount} 扎</span></footer></button>)}</div>}
    </section>
    {visibleBundles.length > 0 && <section className="bundle-grid" aria-label={selectedBedId ? '所选裁床扎包卡片' : '全部扎包卡片'}>
      {visibleBundles.map((bundle) => {
        const selected = selectedBundleNos.has(bundle.no);
        return <article className={`bundle-card ${selected ? 'selected' : ''}`} key={bundle.no}>
          <label className="card-check">
            <input
              type="checkbox"
              checked={selected}
              onChange={(event) => toggleBundle(bundle.no, event.target.checked)}
              aria-label={`选择扎包 ${bundle.no}`}
            />
            <span aria-hidden="true" />
          </label>
          <span className={`status ${bundle.tone}`}>{bundle.status}</span>
          <h2>{bundle.no}</h2>
          <p>{bundle.detail}</p>
          <strong>{bundle.value}</strong>
          <BundleQr code={bundle.code} label={bundle.no} />
          <div className="bundle-card-actions"><button className="text-button" onClick={() => void showTimeline(bundle)}>查看流转记录</button></div>
        </article>;
      })}
    </section>}
    {timelineBundle && <div className="timeline-backdrop" role="presentation" onMouseDown={() => setTimelineBundle(undefined)}>
      <section className="timeline-dialog" role="dialog" aria-modal="true" aria-labelledby="timeline-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><small>扎包 {timelineBundle.no}</small><h2 id="timeline-title">流转记录</h2></div><button aria-label="关闭流转记录" onClick={() => setTimelineBundle(undefined)}>×</button></header>
        {timelineLoading && <p className="timeline-state">正在加载流转记录…</p>}
        {timelineError && <p className="timeline-state error" role="alert">{timelineError}</p>}
        {!timelineLoading && !timelineError && timelineEvents.length === 0 && <p className="timeline-state">暂无流转记录。</p>}
        {timelineEvents.length > 0 && <ol className="timeline-list">
          {timelineEvents.map((event) => {
            const processName = bundleEventProcessName(event);
            const detail = bundleEventDetail(event);
            return <li key={event.id}>
              <i aria-hidden="true" />
              <div><strong>{bundleEventLabel(event.eventType)}</strong><time>{formatTimelineTime(event.eventAt)}</time></div>
              {processName && <p className="timeline-process"><span>执行工艺</span><strong>{processName}</strong></p>}
              {detail && <p>{detail}</p>}
              <small>{event.actorName ? `操作人：${event.actorName}` : '系统记录'}</small>
            </li>;
          })}
        </ol>}
      </section>
    </div>}
  </>;
}

function NewCuttingProductPanel({ existingBedNos, onCreated }: { existingBedNos: string[]; onCreated: (result: BundleGenerationResult) => Promise<void> }) {
  const [ordersList, setOrdersList] = useState<Order[]>([]);
  const [routes, setRoutes] = useState<RouteVersion[]>([]);
  const [orderId, setOrderId] = useState('');
  const [orderItemId, setOrderItemId] = useState('');
  const [routeVersionId, setRouteVersionId] = useState('');
  const [bedNo, setBedNo] = useState('');
  const [cutDate, setCutDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState('');
  const [bundleQty, setBundleQty] = useState('4');
  const [dyeLotNo, setDyeLotNo] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const selectedOrder = ordersList.find((order) => order.id === orderId);
  const selectedItem = selectedOrder?.items.find((item) => item.id === orderItemId);
  const remainingQty = selectedItem ? selectedItem.plannedQty + selectedItem.overproductionLimit - selectedItem.allocatedQty : 0;
  useEffect(() => { let active = true; void listOrders({ limit: 100 }).then((page) => { if (!active) return; const eligible = page.items.filter((order) => order.status === 'RELEASED' || order.status === 'IN_PROGRESS'); setOrdersList(eligible); const first = eligible[0]; setOrderId(first?.id ?? ''); setOrderItemId(first?.items.find((item) => item.allocatedQty < item.plannedQty + item.overproductionLimit)?.id ?? first?.items[0]?.id ?? ''); }).catch((error) => { if (active) setMessage(adminErrorMessage(error)); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  useEffect(() => { if (!selectedOrder) { setRoutes([]); setRouteVersionId(''); return; } let active = true; void listPublishedRouteVersions(selectedOrder.styleId).then((page) => { if (active) { setRoutes(page.items); setRouteVersionId(page.items[0]?.id ?? ''); } }).catch((error) => { if (active) setMessage(adminErrorMessage(error)); }); return () => { active = false; }; }, [selectedOrder?.id]);
  useEffect(() => { if (selectedItem) { const next = Math.max(0, selectedItem.plannedQty + selectedItem.overproductionLimit - selectedItem.allocatedQty); setQuantity(next ? String(next) : ''); setDyeLotNo(selectedItem.dyeLotNo ?? ''); } }, [selectedItem?.id]);
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); if (saving) return; const allocateQty = Number(quantity); const standardQty = Number(bundleQty); const normalizedBedNo = bedNo.trim().toUpperCase(); if (!selectedOrder || !selectedItem) return setMessage('请选择订单和颜色尺码明细。'); if (!routeVersionId) return setMessage('该款式没有已发布工艺路线，暂不能生成扎包。'); if (!normalizedBedNo) return setMessage('请输入床号。'); if (existingBedNos.some((value) => value.toUpperCase() === normalizedBedNo)) return setMessage(`床号 ${normalizedBedNo} 已存在，请使用新的床号；如需处理已有裁床，请在下方现有批次中继续操作。`); if (!Number.isInteger(allocateQty) || allocateQty < 1 || allocateQty > remainingQty) return setMessage(`本次裁剪数量必须为 1-${remainingQty} 件。`); if (!Number.isInteger(standardQty) || standardQty < 1) return setMessage('每扎数量必须是大于 0 的整数。'); setSaving(true); setMessage(undefined); try { const bed = await createCuttingBed({ orderId: selectedOrder.id, bedNo: normalizedBedNo, cutDate, plyCount: null, dyeLotNo: dyeLotNo.trim() || null, supervisorWorkerId: null, notes: null }); const result = await generateBundles(bed.id, { routeVersionId, bundleNoPrefix: null, lines: [{ orderItemId: selectedItem.id, standardBundleQty: standardQty, quantityToAllocate: allocateQty, allowTailBundle: true, authorizedOverproductionQty: 0, overproductionReason: null }] }); await onCreated(result); } catch (error) { setMessage(adminErrorMessage(error)); } finally { setSaving(false); } }
  return <form className="panel cutting-product-panel" onSubmit={(event) => void submit(event)}><div className="skill-manager-head"><div><h2>新增裁床产品</h2><p>从已下达或生产中的订单选择颜色尺码，创建裁床并生成可追溯扎包。</p></div><span>订单追溯</span></div>{message && <div className="skill-manager-message error" role="alert">{message}</div>}{loading ? <p className="admin-empty">正在加载可裁订单…</p> : ordersList.length === 0 ? <p className="admin-empty">没有可裁订单；请先下达生产订单。</p> : <><div className="cutting-product-grid"><label>生产订单 <em>必填</em><select value={orderId} onChange={(event) => { const next = ordersList.find((order) => order.id === event.target.value); setOrderId(event.target.value); setOrderItemId(next?.items[0]?.id ?? ''); }}><option value="">请选择订单</option>{ordersList.map((order) => <option key={order.id} value={order.id}>{order.orderNo} · {order.styleCode} {order.styleName}</option>)}</select></label><label>颜色 / 尺码 <em>必填</em><select value={orderItemId} onChange={(event) => setOrderItemId(event.target.value)}>{selectedOrder?.items.map((item) => <option key={item.id} value={item.id} disabled={item.allocatedQty >= item.plannedQty + item.overproductionLimit}>{item.colorName} / {item.sizeName} · 剩余 {Math.max(0, item.plannedQty + item.overproductionLimit - item.allocatedQty)} 件</option>)}</select></label><label>已发布工艺 <em>必填</em><select value={routeVersionId} onChange={(event) => setRouteVersionId(event.target.value)}><option value="">请选择工艺路线</option>{routes.map((route) => <option key={route.id} value={route.id}>V{route.versionNo} · {route.steps.length} 道工序</option>)}</select></label><label>床号 <em>必填</em><input value={bedNo} maxLength={40} onChange={(event) => setBedNo(event.target.value)} placeholder="例如 BED-260830-01" /></label><label>裁剪日期 <em>必填</em><input type="date" value={cutDate} onChange={(event) => setCutDate(event.target.value)} required /></label><label>本次裁剪数量 <em>必填</em><input type="number" min="1" max={remainingQty || undefined} step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><label>每扎数量 <em>必填</em><input type="number" min="1" step="1" value={bundleQty} onChange={(event) => setBundleQty(event.target.value)} /></label><label>缸号<input value={dyeLotNo} maxLength={60} onChange={(event) => setDyeLotNo(event.target.value)} placeholder="默认使用订单明细缸号" /></label></div><div className="cutting-product-actions"><span>创建后将立即生成扎包二维码；尾数不足一扎时自动生成尾扎。</span><button className="button primary" disabled={saving || !routeVersionId || remainingQty < 1}>{saving ? '正在创建…' : '创建裁床并生成扎包'}</button></div></>}</form>;
}

function BundleQr({ code, label }: { code: string; label: string }) {
  const [source, setSource] = useState<string>();

  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(workerBundleUrl(code), {
      width: 192,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#173f37', light: '#ffffff' },
    }).then((nextSource) => {
      if (active) setSource(nextSource);
    });
    return () => { active = false; };
  }, [code]);

  return <div className="bundle-qr">
    {source ? <img src={source} alt={`扎包 ${label} 报工二维码`} /> : <span aria-live="polite">二维码生成中…</span>}
    <small>扫码登录报工<br /><strong>{label}</strong></small>
  </div>;
}
function workerBundleUrl(code: string): string {
  const base = import.meta.env.VITE_WORKER_PUBLIC_URL || '/worker/';
  const url = new URL(base, window.location.origin);
  url.searchParams.set('bundle', code);
  return url.toString();
}

function bundleCardData(bundle: Bundle): BundleCardData {
  return {
    id: bundle.id,
    orderId: bundle.orderId,
    cuttingBedId: bundle.cuttingBedId,
    bedNo: bundle.bedNo ?? '未记录',
    orderNo: bundle.orderNo ?? '未记录',
    styleLabel: [bundle.styleCode, bundle.styleName].filter(Boolean).join(' · '),
    colorSizeLabel: `${bundle.colorName ?? bundle.colorCode ?? '未记录颜色'} / ${bundle.sizeName ?? bundle.sizeCode ?? '未记录尺码'}`,
    effectiveQty: bundle.effectiveQty,
    no: bundle.bundleNo,
    code: bundle.shortCode,
    status: bundleStatusLabel(bundle.status),
    statusCode: bundle.status,
    detail: `${bundle.styleCode} · ${bundle.colorName} / ${bundle.sizeName}`,
    value: bundle.status === 'IN_PROGRESS' && bundle.currentProcessName
      ? bundle.currentProcessName
      : `${bundle.effectiveQty} 件`,
    tone: bundleStatusTone(bundle.status),
    generationSource: {
      cuttingBedId: bundle.cuttingBedId,
      routeVersionId: bundle.routeVersionId,
      orderItemId: bundle.orderItemId,
      standardBundleQty: bundle.plannedQty,
    },
  };
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  const protectedText = typeof value === 'string' && /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replaceAll('"', '""')}"`;
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '_');
}

function exportDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '';
}

function exportWorkStatus(status: string): string {
  return ({ STARTED: '加工中', COMPLETED: '已完成', CANCELLED: '已取消', SKIPPED: '已跳过' } as Record<string, string>)[status] ?? status;
}

function bundleEventLabel(eventType: string): string {
  return ({
    CREATED: '扎包已创建', PRINTED: '卡片已打印', STARTED: '工序已开工', COMPLETED: '工序已完工',
    BLOCKED: '扎包已阻塞', UNBLOCKED: '扎包已解除阻塞', QUALITY: '质量记录', ADJUSTED: '数量已调整',
    PRICE_ADJUSTED: '工价已调整', SPLIT: '扎包已拆分', MERGED: '扎包已合并', SKIPPED: '工序已跳过',
    CANCELLED: '扎包已作废', TOKEN_ROTATED: '二维码已更新',
  } as Record<string, string>)[eventType] ?? eventType;
}

function formatTimelineTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(value));
}

function bundleEventProcessName(event: BundleEvent): string | null {
  const payload = event.payload as Record<string, unknown>;
  return typeof payload.processName === 'string' && payload.processName.trim() ? payload.processName : null;
}

function bundleEventDetail(event: BundleEvent): string | null {
  const payload = event.payload as Record<string, unknown>;
  const reason = typeof payload.reason === 'string' ? payload.reason : null;
  const goodQty = typeof payload.goodQty === 'number' ? payload.goodQty : null;
  if (reason) return `原因：${reason}`;
  if (goodQty !== null) return `良品 ${goodQty} 件`;
  return null;
}

function bundleStatusLabel(status: string): string {
  return ({ CREATED: '待开工', IN_PROGRESS: '加工中', BLOCKED: '已阻塞', COMPLETED: '已完成', CANCELLED: '已作废' } as Record<string, string>)[status] ?? status;
}

function bundleStatusTone(status: string): string {
  if (status === 'IN_PROGRESS') return 'active';
  if (status === 'BLOCKED' || status === 'CANCELLED') return 'danger';
  if (status === 'CREATED') return 'warning';
  return 'neutral';
}

function AdminLoginScreen({ busy, message, onLogin }: {
  busy: boolean;
  message: string | null;
  onLogin: (account: string, secret: string, organizationCode: string) => Promise<void>;
}) {
  const [account, setAccount] = useState('');
  const [secret, setSecret] = useState('');
  const [organizationCode, setOrganizationCode] = useState('');
  return <main className="admin-login-shell"><section className="admin-login-card">
    <div className="login-brand"><span className="brand-mark">YC</span><div><strong>云裁生产</strong><small>管理后台</small></div></div>
    <div className="login-copy"><p>管理员登录</p><h1>查看员工与工序统计</h1><span>登录后加载当前工厂的真实扎包、报工人员和计件数据。</span></div>
    {message && <div className="admin-message" role="alert">{message}</div>}
    <form onSubmit={(event) => { event.preventDefault(); void onLogin(account.trim(), secret, organizationCode); }}>
      <label>用户名或工号<input autoComplete="username" value={account} onChange={(event) => setAccount(event.target.value)} placeholder="请输入用户名或工号" required /></label>
      <label>密码或 PIN<input type="password" autoComplete="current-password" value={secret} onChange={(event) => setSecret(event.target.value)} minLength={4} required /></label>
      <label>组织代码 <small>选填</small><input value={organizationCode} onChange={(event) => setOrganizationCode(event.target.value.toUpperCase())} placeholder="请输入组织代码" /></label>
      <button className="button primary" disabled={busy}>{busy ? '正在登录…' : '登录管理后台'}</button>
    </form>
  </section></main>;
}

function WorkersPage({ data }: { data: ProductionOverview | undefined }) {
  const [managingSkills, setManagingSkills] = useState(false);
  const [managingAccounts, setManagingAccounts] = useState(false);
  const [creatingWorker, setCreatingWorker] = useState(false);
  const [workerVersion, setWorkerVersion] = useState(0);
  const rows = data?.workerMetrics ?? [];
  const workerCount = new Set(rows.map((row) => row.workerId)).size;
  const completedBundles = rows.reduce((total, row) => total + row.completedBundles, 0);
  const goodQty = rows.reduce((total, row) => total + row.goodQty, 0);
  const activeTasks = rows.reduce((total, row) => total + row.activeTasks, 0);
  return <>
    <PageHeading eyebrow="人员与标准工序" title="员工工种统计" subtitle={`${data?.date ?? '今日'} · 按当天已完成的员工工序报工统计；每 30 秒自动刷新。`}>
      <button className={`button ${creatingWorker ? 'secondary' : 'primary'}`} onClick={() => setCreatingWorker((current) => !current)}>{creatingWorker ? '关闭新增员工' : '＋ 新增员工'}</button>
      <button className={`button ${managingAccounts ? 'secondary' : 'primary'}`} onClick={() => setManagingAccounts((current) => !current)}>{managingAccounts ? '关闭账号管理' : '员工账号管理'}</button>
      <button className={`button ${managingSkills ? 'secondary' : 'primary'}`} onClick={() => setManagingSkills((current) => !current)}>
        {managingSkills ? '关闭工序设置' : '工序价格与员工分配'}
      </button>
    </PageHeading>
    {creatingWorker && <WorkerCreatePanel onCreated={() => { setCreatingWorker(false); setWorkerVersion((value) => value + 1); }} />}
    {managingAccounts && <WorkerAccountManager key={`accounts-${workerVersion}`} />}
    {managingSkills && <WorkerSkillManager key={`skills-${workerVersion}`} />}
    <section className="metrics worker-stat-metrics" aria-label="员工报工统计摘要">
      <Metric featured label="报工员工" value={workerCount.toLocaleString()} unit="人" foot="按员工去重" />
      <Metric label="完成工序" value={completedBundles.toLocaleString()} unit="扎次" foot="同一扎多道工序分别计数" />
      <Metric label="完成良品" value={goodQty.toLocaleString()} unit="件" foot="不含次品和短缺" />
      <Metric warning={activeTasks > 0} label="加工中任务" value={activeTasks.toLocaleString()} unit="项" foot="已开工、尚未完工" />
    </section>
    <article className="panel table-wrap"><div className="panel-head"><div><h2>员工 × 工序明细</h2><p>每行按员工和工序汇总；“完成工序”表示该道工序已报工，不代表整扎所有工序均已完成。</p></div></div>
      {rows.length > 0 ? <table className="worker-stat-table"><thead><tr><th>员工</th><th>标准工序</th><th>完成工序</th><th>加工中</th><th>良品</th><th>次品 / 短缺</th><th>预计计件</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.workerId}-${row.processId}`}><td><strong>{row.workerName}</strong><small>{row.workerNo}</small></td><td><strong>{row.processName}</strong><small>{row.processCode}</small></td><td>{row.completedBundles} 扎次</td><td>{row.activeTasks > 0 ? <span className="status active">{row.activeTasks} 项</span> : '—'}</td><td><strong>{row.goodQty} 件</strong></td><td>{row.defectQty} / {row.missingQty}</td><td><strong>¥{Number(row.pieceworkAmount).toFixed(2)}</strong></td></tr>)}</tbody></table> : <div className="admin-empty">当天尚无员工报工；员工扫码开工后会立即显示在这里。</div>}
    </article>
  </>;
}

function WorkerCreatePanel({ onCreated }: { onCreated: () => void }) {
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [lines, setLines] = useState<ProductionLine[]>([]);
  const [workerNo, setWorkerNo] = useState('');
  const [name, setName] = useState('');
  const [workshopId, setWorkshopId] = useState('');
  const [productionLineId, setProductionLineId] = useState('');
  const [hiredOn, setHiredOn] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  useEffect(() => { let active = true; void Promise.all([listWorkshops({ limit: 200, status: 'ACTIVE' }), listProductionLines({ limit: 200, status: 'ACTIVE' })]).then(([workshopPage, linePage]) => { if (active) { setWorkshops(workshopPage.items); setLines(linePage.items); } }).catch((error) => { if (active) setMessage(adminErrorMessage(error)); }); return () => { active = false; }; }, []);
  const availableLines = workshopId ? lines.filter((line) => line.workshopId === workshopId) : lines;
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); if (saving) return; if (!workerNo.trim() || !name.trim()) return setMessage('请填写工号和姓名。'); setSaving(true); setMessage(undefined); try { await createWorker({ workerNo: workerNo.trim().toUpperCase(), name: name.trim(), userId: null, workshopId: workshopId || null, productionLineId: productionLineId || null, hiredOn: hiredOn || null, status: 'ACTIVE', skills: [] }); onCreated(); } catch (error) { setMessage(adminErrorMessage(error)); } finally { setSaving(false); } }
  return <form className="panel worker-create-panel" onSubmit={(event) => void submit(event)}><div className="skill-manager-head"><div><h2>新增员工</h2><p>先建立员工基础资料；创建后可继续分配工序并创建最小权限登录账号。</p></div><span>在职</span></div>{message && <div className="skill-manager-message error" role="alert">{message}</div>}<div className="worker-create-grid"><label>工号 <em>必填</em><input value={workerNo} maxLength={40} onChange={(event) => setWorkerNo(event.target.value)} placeholder="例如 W002" required autoFocus /></label><label>姓名 <em>必填</em><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="员工姓名" required /></label><label>车间<select value={workshopId} onChange={(event) => { setWorkshopId(event.target.value); setProductionLineId(''); }}><option value="">暂不指定</option>{workshops.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label><label>生产线<select value={productionLineId} onChange={(event) => setProductionLineId(event.target.value)}><option value="">暂不指定</option>{availableLines.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label><label>入职日期<input type="date" value={hiredOn} onChange={(event) => setHiredOn(event.target.value)} /></label></div><div className="worker-create-actions"><span>账号和工序不会自动创建，可在下方继续维护。</span><button className="button primary" disabled={saving}>{saving ? '正在创建…' : '创建员工'}</button></div></form>;
}

function WorkerAccountManager() {
  const [items, setItems] = useState<WorkerAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string>();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string }>();
  async function reload() { setLoading(true); try { setItems((await listWorkerAccounts()).items); } catch (error) { setMessage({ tone: 'error', text: adminErrorMessage(error) }); } finally { setLoading(false); } }
  useEffect(() => { void reload(); }, []);
  async function create(item: WorkerAccount) { if (password.length < 8) return setMessage({ tone: 'error', text: '临时密码至少 8 位。' }); try { await createWorkerAccount({ workerId: item.workerId, username: username.trim(), displayName: item.workerName, password }); setPassword(''); setEditing(undefined); setMessage({ tone: 'success', text: `${item.workerName} 的账号已创建并绑定。` }); await reload(); } catch (error) { setMessage({ tone: 'error', text: adminErrorMessage(error) }); } }
  async function toggle(item: WorkerAccount) { if (!item.userId) return; try { await setWorkerAccountStatus(item.userId, item.accountStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'); setMessage({ tone: 'success', text: '账号状态已更新，旧会话已撤销。' }); await reload(); } catch (error) { setMessage({ tone: 'error', text: adminErrorMessage(error) }); } }
  async function reset(item: WorkerAccount) { if (!item.userId || password.length < 8) return setMessage({ tone: 'error', text: '请输入至少 8 位的新临时密码。' }); try { await resetWorkerAccountPassword(item.userId, password); setPassword(''); setEditing(undefined); setMessage({ tone: 'success', text: '临时密码已重置，旧会话已撤销。' }); } catch (error) { setMessage({ tone: 'error', text: adminErrorMessage(error) }); } }
  return <section className="panel account-manager"><div className="skill-manager-head"><div><h2>员工账号管理</h2><p>账号仅获得扫码、报工和查看本人计件权限；此处不能授予管理员权限。</p></div><span>最小权限</span></div>{message && <div className={`skill-manager-message ${message.tone}`}>{message.text}</div>}{loading ? <p className="admin-empty">正在加载员工账号…</p> : <div className="account-list">{items.map((item) => <div className="account-row" key={item.workerId}><div><strong>{item.workerName}</strong><small>{item.workerNo} · {item.username ?? '未绑定账号'}</small></div><span className={`status ${item.accountStatus === 'ACTIVE' ? 'active' : 'neutral'}`}>{item.accountStatus === 'ACTIVE' ? '已启用' : item.accountStatus === 'INACTIVE' ? '已停用' : '未创建'}</span><div className="account-actions">{editing === item.workerId ? <><input aria-label={`${item.workerName} 用户名`} value={username} onChange={(e) => setUsername(e.target.value)} placeholder="登录用户名" disabled={Boolean(item.userId)} /><input aria-label={`${item.workerName} 临时密码`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 8 位临时密码" /><button className="button primary" onClick={() => void (item.userId ? reset(item) : create(item))}>{item.userId ? '确认重置' : '创建并绑定'}</button><button className="button secondary" onClick={() => { setEditing(undefined); setPassword(''); }}>取消</button></> : <>{item.userId && <button className="button secondary" onClick={() => void toggle(item)}>{item.accountStatus === 'ACTIVE' ? '停用' : '启用'}</button>}<button className="button secondary" disabled={item.workerStatus === 'LEFT'} onClick={() => { setEditing(item.workerId); setUsername(item.username ?? item.workerNo.toLowerCase()); }}>{item.userId ? '重置密码' : '创建账号'}</button></>}</div></div>)}</div>}</section>;
}

interface SkillDraftItem {
  level: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

function WorkerSkillManager() {
  const [workersList, setWorkersList] = useState<Worker[]>([]);
  const [processList, setProcessList] = useState<MasterDataItem[]>([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [draft, setDraft] = useState<Record<string, SkillDraftItem>>({});
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});
  const [applyHistoricalRates, setApplyHistoricalRates] = useState(false);
  const [priceAdjustmentReason, setPriceAdjustmentReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPriceId, setSavingPriceId] = useState<string>();
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string }>();
  const [priceMessage, setPriceMessage] = useState<{ tone: 'success' | 'error'; text: string }>();

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([
      listWorkers({ limit: 100, status: 'ACTIVE' }),
      listProcesses({ limit: 100, status: 'ACTIVE' }),
    ]).then(([workerPage, processPage]) => {
      if (!active) return;
      setWorkersList(workerPage.items);
      setProcessList(processPage.items);
      setPriceDraft(Object.fromEntries(processPage.items.map((process) => [
        process.id,
        process.defaultPieceRate ?? '0.0000',
      ])));
      setSelectedWorkerId(workerPage.items[0]?.id ?? '');
    }).catch((error: unknown) => {
      if (active) setMessage({ tone: 'error', text: adminErrorMessage(error) });
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedWorkerId) {
      setDraft({});
      return;
    }
    let active = true;
    setLoading(true);
    setMessage(undefined);
    void listWorkerSkills(selectedWorkerId).then((skills) => {
      if (active) setDraft(skillDraft(skills));
    }).catch((error: unknown) => {
      if (active) setMessage({ tone: 'error', text: adminErrorMessage(error) });
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [selectedWorkerId]);

  function toggleProcess(processId: string, selected: boolean) {
    setDraft((current) => {
      const next = { ...current };
      if (selected) next[processId] = next[processId] ?? { level: 3, effectiveFrom: null, effectiveTo: null };
      else delete next[processId];
      return next;
    });
    setMessage(undefined);
  }

  async function saveProcessPrice(process: MasterDataItem) {
    const value = priceDraft[process.id]?.trim() ?? '';
    if (!/^\d+(?:\.\d{1,4})?$/.test(value)) {
      setPriceMessage({ tone: 'error', text: '单价必须是非负数，最多保留 4 位小数。' });
      return;
    }
    if (typeof process.version !== 'number') {
      setPriceMessage({ tone: 'error', text: '工序版本信息缺失，请刷新页面后重试。' });
      return;
    }
    if (applyHistoricalRates && !priceAdjustmentReason.trim()) {
      setPriceMessage({ tone: 'error', text: '调整历史扎包时必须填写调整原因。' });
      return;
    }
    setSavingPriceId(process.id);
    setPriceMessage(undefined);
    try {
      const result = await adjustProcessRate(process.id, {
        expectedVersion: process.version,
        unitRate: value,
        applyToHistoricalBundles: applyHistoricalRates,
        reason: applyHistoricalRates ? priceAdjustmentReason.trim() : null,
      });
      const updated = result.process;
      setProcessList((current) => current.map((item) => item.id === updated.id ? updated : item));
      setPriceDraft((current) => ({ ...current, [updated.id]: updated.defaultPieceRate ?? '0.0000' }));
      setPriceAdjustmentReason('');
      setPriceMessage({
        tone: 'success',
        text: applyHistoricalRates
          ? `${updated.name} 已调价；更新 ${result.updatedBundleSteps} 个历史扎包工序，为 ${result.createdAdjustments} 条已完成计件生成差额 ¥${result.totalAdjustmentAmount}。`
          : `${updated.name} 单价已更新为 ¥${Number(updated.defaultPieceRate ?? 0).toFixed(4)}；只影响以后新生成的扎包。`,
      });
    } catch (error) {
      setPriceMessage({ tone: 'error', text: adminErrorMessage(error) });
    } finally {
      setSavingPriceId(undefined);
    }
  }

  async function saveSkills() {
    if (!selectedWorkerId || saving) return;
    setSaving(true);
    setMessage(undefined);
    const skills: WorkerSkillInput[] = Object.entries(draft).map(([processId, skill]) => ({
      processId,
      level: skill.level,
      effectiveFrom: skill.effectiveFrom,
      effectiveTo: skill.effectiveTo,
    }));
    try {
      const saved = await replaceWorkerSkills(selectedWorkerId, skills);
      setDraft(skillDraft(saved));
      setMessage({ tone: 'success', text: `已保存 ${saved.length} 项员工技能；员工下次扫码时立即生效。` });
    } catch (error) {
      setMessage({ tone: 'error', text: adminErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  const selectedWorker = workersList.find((worker) => worker.id === selectedWorkerId);
  return <section className="panel skill-manager" aria-label="工序价格与员工分配">
    <div className="skill-manager-head">
      <div><h2>工序价格与员工分配</h2><p>先维护标准工序单价，再为员工分配扫码报工时可以选择的工序。</p></div>
      <span>{processList.length} 个标准工序</span>
    </div>
    <section className="manager-section" aria-labelledby="process-price-title">
      <div className="manager-section-head"><div><strong id="process-price-title">1. 标准工序单价</strong><p>可选择只影响未来扎包，或同步调整未开工、加工中和已完成扎包；已完成计件以差额记录保留审计。</p></div></div>
      {priceMessage && <div className={`skill-manager-message ${priceMessage.tone}`} role={priceMessage.tone === 'error' ? 'alert' : 'status'}>{priceMessage.text}</div>}
      <div className="historical-rate-options">
        <label><input type="checkbox" checked={applyHistoricalRates} onChange={(event) => { setApplyHistoricalRates(event.target.checked); setPriceMessage(undefined); }} /><span><b>同步调整历史扎包</b><small>包括未开工、加工中和已完成；已完成工资新增差额记录，不覆盖原金额。</small></span></label>
        {applyHistoricalRates && <label className="price-reason-field">调整原因<input value={priceAdjustmentReason} maxLength={500} onChange={(event) => setPriceAdjustmentReason(event.target.value)} placeholder="例如：2026 年 8 月统一调整工价" required /></label>}
      </div>
      <div className="process-price-list">
        {loading ? <p className="skill-empty">正在加载标准工序…</p> : processList.length === 0 ? <p className="skill-empty">暂无启用的标准工序，请先维护工序基础资料。</p> : processList.map((process) => <div className="process-price-row" key={process.id}>
          <span><b>{process.name}</b><small>{process.code}</small></span>
          <label>单价（元 / 良品件）
            <input type="text" inputMode="decimal" value={priceDraft[process.id] ?? ''} onChange={(event) => setPriceDraft((current) => ({ ...current, [process.id]: event.target.value }))} aria-label={`${process.name}单价`} />
          </label>
          <button className="button secondary" disabled={savingPriceId !== undefined} onClick={() => void saveProcessPrice(process)}>{savingPriceId === process.id ? '保存中…' : applyHistoricalRates ? '保存并调整历史' : '保存单价'}</button>
        </div>)}
      </div>
    </section>
    <section className="manager-section" aria-labelledby="worker-skill-title">
      <div className="manager-section-head"><div><strong id="worker-skill-title">2. 员工可选工序</strong><p>未分配给员工的工序不会出现在该员工的扫码报工页面。</p></div><span>{Object.keys(draft).length} 项已分配技能</span></div>
      {message && <div className={`skill-manager-message ${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</div>}
      <div className="skill-manager-form">
      <label className="skill-worker-field">员工
        <select value={selectedWorkerId} onChange={(event) => setSelectedWorkerId(event.target.value)} disabled={loading || workersList.length === 0}>
          {workersList.length === 0 && <option value="">暂无可用员工</option>}
          {workersList.map((worker) => <option key={worker.id} value={worker.id}>{worker.name} · {worker.workerNo}</option>)}
        </select>
        {selectedWorker && <small>当前编辑：{selectedWorker.name}（{selectedWorker.workerNo}）</small>}
      </label>
      <div className="skill-processes" aria-busy={loading}>
        <strong>标准工序与技能等级</strong>
        {loading ? <p className="skill-empty">正在加载员工技能…</p> : processList.length === 0 ? <p className="skill-empty">暂无启用的标准工序，请先维护工序基础资料。</p> : processList.map((process) => {
          const selected = draft[process.id] !== undefined;
          return <div className={`skill-process-row ${selected ? 'selected' : ''}`} key={process.id}>
            <label>
              <input type="checkbox" checked={selected} onChange={(event) => toggleProcess(process.id, event.target.checked)} />
              <span><b>{process.name}</b><small>{process.code}</small></span>
            </label>
            <select aria-label={`${process.name}技能等级`} value={draft[process.id]?.level ?? 3} disabled={!selected} onChange={(event) => setDraft((current) => ({ ...current, [process.id]: { ...current[process.id]!, level: Number(event.target.value) } }))}>
              {[1, 2, 3, 4, 5].map((level) => <option value={level} key={level}>L{level}</option>)}
            </select>
          </div>;
        })}
      </div>
    </div>
      <div className="skill-manager-actions">
        <span>保存后只影响后续可选工序，不修改历史报工记录。</span>
        <button className="button primary" disabled={loading || saving || !selectedWorkerId} onClick={() => void saveSkills()}>{saving ? '保存中…' : '保存员工工序'}</button>
      </div>
    </section>
  </section>;
}

function skillDraft(skills: WorkerSkill[]): Record<string, SkillDraftItem> {
  return Object.fromEntries(skills.map((skill) => [skill.processId, {
    level: skill.level,
    effectiveFrom: skill.effectiveFrom ?? null,
    effectiveTo: skill.effectiveTo ?? null,
  }]));
}
type PieceworkStatusFilter = '' | 'PENDING' | 'CONFIRMED' | 'SETTLED' | 'REVERSED';

function payrollRange(period: 'TODAY' | 'WEEK' | 'MONTH'): { from: string; to: string } {
  const to = todayDateInput();
  if (period === 'TODAY') return { from: to, to };
  if (period === 'MONTH') return { from: `${to.slice(0, 7)}-01`, to };
  const date = new Date(`${to}T00:00:00`);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  const offset = date.getTimezoneOffset() * 60_000;
  return { from: new Date(date.getTime() - offset).toISOString().slice(0, 10), to };
}

function pieceworkStatusLabel(status: string): string {
  return ({ PENDING: '待确认', CONFIRMED: '已确认', SETTLED: '已结算', REVERSED: '已冲销' } as Record<string, string>)[status] ?? status;
}

function pieceworkStatusTone(status: string): string {
  return ({ PENDING: 'warning', CONFIRMED: 'active', SETTLED: 'active', REVERSED: 'danger' } as Record<string, string>)[status] ?? 'neutral';
}

function PayrollPage() {
  const initialRange = payrollRange('MONTH');
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [workerId, setWorkerId] = useState('');
  const [bundleNo, setBundleNo] = useState('');
  const [status, setStatus] = useState<PieceworkStatusFilter>('');
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [entries, setEntries] = useState<PieceworkEntry[]>([]);
  const [summary, setSummary] = useState<PieceworkSummary>();
  const [nextCursor, setNextCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>();

  function queryFor(rangeFrom = from, rangeTo = to, cursor?: string) {
    return {
      limit: 100,
      from: rangeFrom,
      to: rangeTo,
      ...(workerId ? { workerId } : {}),
      ...(bundleNo.trim() ? { bundleNo: bundleNo.trim() } : {}),
      ...(status ? { settlementStatus: status } : {}),
      ...(cursor ? { cursor } : {}),
    };
  }

  async function load(rangeFrom = from, rangeTo = to, cursor?: string) {
    setLoading(true);
    setMessage(undefined);
    try {
      const page = await listPieceworkEntries(queryFor(rangeFrom, rangeTo, cursor));
      setEntries((current) => cursor ? [...current, ...page.items] : page.items);
      setSummary(page.summary);
      setNextCursor(page.page.nextCursor ?? undefined);
    } catch (error) {
      setMessage(adminErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void Promise.all([
      listWorkers({ limit: 200, status: 'ACTIVE' }),
      listPieceworkEntries({ limit: 100, from: initialRange.from, to: initialRange.to }),
    ]).then(([workerPage, pieceworkPage]) => {
      if (!active) return;
      setWorkers(workerPage.items);
      setEntries(pieceworkPage.items);
      setSummary(pieceworkPage.summary);
      setNextCursor(pieceworkPage.page.nextCursor ?? undefined);
    }).catch((error: unknown) => {
      if (active) setMessage(adminErrorMessage(error));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  function useQuickRange(period: 'TODAY' | 'WEEK' | 'MONTH') {
    const range = payrollRange(period);
    setFrom(range.from);
    setTo(range.to);
    void load(range.from, range.to);
  }

  return <>
    <PageHeading eyebrow="透明计件" title="计件工资总览" subtitle="按时间、员工、扎包和确认状态查询工资；金额来自完成报工时保存的工价快照。"><span /></PageHeading>
    <section className="panel piecework-filters" aria-label="计件工资筛选">
      <div className="piecework-quick-ranges"><strong>时间范围</strong><button onClick={() => useQuickRange('TODAY')}>今日</button><button onClick={() => useQuickRange('WEEK')}>本周</button><button onClick={() => useQuickRange('MONTH')}>本月</button></div>
      <div className="piecework-filter-grid">
        <label>开始日期<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>结束日期<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
        <label>员工<select value={workerId} onChange={(event) => setWorkerId(event.target.value)}><option value="">全部员工</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.workerNo} · {worker.name}</option>)}</select></label>
        <label>扎包号<input value={bundleNo} maxLength={80} onChange={(event) => setBundleNo(event.target.value)} placeholder="输入完整或部分扎包号" /></label>
        <label>工资状态<select value={status} onChange={(event) => setStatus(event.target.value as PieceworkStatusFilter)}><option value="">全部状态</option><option value="PENDING">待确认</option><option value="CONFIRMED">已确认</option><option value="SETTLED">已结算</option><option value="REVERSED">已冲销</option></select></label>
        <button className="button primary" disabled={loading || !from || !to} onClick={() => void load()}>{loading ? '查询中…' : '查询工资'}</button>
      </div>
      {message && <div className="skill-manager-message error" role="alert">{message}</div>}
    </section>
    <section className="metrics piecework-metrics" aria-label="筛选结果汇总">
      <Metric featured label="计件金额" value={summary ? `¥${Number(summary.totalAmount).toFixed(2)}` : '—'} foot={summary ? `${summary.entryCount} 条计件记录` : '等待查询'} />
      <Metric label="员工" value={summary ? summary.workerCount.toLocaleString() : '—'} unit="人" foot="按筛选结果去重" />
      <Metric label="扎包" value={summary ? summary.bundleCount.toLocaleString() : '—'} unit="扎" foot="按筛选结果去重" />
      <Metric label="计件数量" value={summary ? summary.totalQuantity.toLocaleString() : '—'} unit="件" foot={`${from} 至 ${to}`} />
    </section>
    <article className="panel piecework-results">
      <PanelHead title="工资明细" subtitle={summary ? `共 ${summary.entryCount} 条，当前显示 ${entries.length} 条` : '按报工完成时间倒序排列'} />
      {loading && entries.length === 0 ? <p className="admin-empty">正在查询计件工资…</p> : entries.length === 0 ? <p className="admin-empty">当前筛选条件下没有计件记录。</p> : <div className="table-wrap"><table className="piecework-table"><thead><tr><th>时间</th><th>员工</th><th>扎包</th><th>执行工艺</th><th>计件数量</th><th>单价</th><th>金额</th><th>状态</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td>{formatTimelineTime(entry.occurredAt)}</td><td><strong>{entry.workerName}</strong><small>{entry.workerNo}</small></td><td><strong>{entry.bundleNo}</strong></td><td><strong>{entry.processName}</strong>{entry.isRework && <small>返工</small>}</td><td>{entry.quantity.toLocaleString()} 件</td><td>¥{Number(entry.unitRate).toFixed(4)}</td><td><strong>¥{Number(entry.amount).toFixed(2)}</strong>{entry.reason && <small>{entry.reason}</small>}</td><td><span className={`status ${pieceworkStatusTone(entry.status)}`}>{pieceworkStatusLabel(entry.status)}</span></td></tr>)}</tbody></table></div>}
      {nextCursor && <div className="piecework-load-more"><button className="button secondary" disabled={loading} onClick={() => void load(from, to, nextCursor)}>{loading ? '加载中…' : '加载更多'}</button></div>}
    </article>
  </>;
}
function PageHeading({ eyebrow, title, subtitle, children }: { eyebrow: string; title: string; subtitle: string; children: React.ReactNode }) { return <header className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{subtitle}</p></div><div className="heading-actions">{children}</div></header>; }
function Metric({ label, value, unit, foot, featured, warning }: { label: string; value: string; unit?: string; foot: string; featured?: boolean; warning?: boolean }) { return <article className={`metric ${featured ? 'featured' : ''} ${warning ? 'warning' : ''}`}><span>{label}</span><strong>{value} {unit && <small>{unit}</small>}</strong><p>{foot}</p></article>; }
function PanelHead({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) { return <div className="panel-head"><div><h2>{title}</h2><p>{subtitle}</p></div>{action}</div>; }
function Alert({ tone, title, detail, time }: { tone: string; title: string; detail: string; time: string }) { return <button className="alert"><i className={tone} /><span><strong>{title}</strong><small>{detail}</small></span><time>{time}</time></button>; }
function OrderTable({ data = [], onEdit, onConfigureRoute, onRelease, releasingOrderId }: { data?: Order[]; onEdit?: (order: Order) => void; onConfigureRoute?: (styleId: string) => void; onRelease?: (order: Order) => void; releasingOrderId?: string | undefined }) {
  if (data.length === 0) return <div className="admin-empty">当前没有符合条件的生产订单。</div>;
  return <div className="table-wrap"><table><thead><tr><th>订单 / 款式</th><th>计划数量</th><th>已分配</th><th>生产进度</th><th>交期</th><th>状态</th>{(onEdit || onConfigureRoute || onRelease) && <th>操作</th>}</tr></thead><tbody>{data.map((order) => {
    const progress = Math.max(0, Math.min(100, Number(order.progressPercent ?? 0)));
    return <tr key={order.id}>
      <td><strong>{order.orderNo}</strong><small>{order.styleCode} · {order.styleName ?? order.styleCode}</small></td>
      <td>{order.totalPlannedQty.toLocaleString()} 件</td>
      <td>{(order.allocatedQty ?? 0).toLocaleString()} 件</td>
      <td><div className="progress"><span><i style={{ width: `${progress}%` }} /></span><b>{progress.toFixed(1)}%</b></div></td>
      <td>{order.dueDate ? order.dueDate.slice(5) : '未设置'}</td>
      <td><span className={`status ${orderStatusTone(order.status)}`}>{orderStatusLabel(order.status)}</span></td>
      {(onEdit || onConfigureRoute || onRelease) && <td><div className="order-row-actions">{order.status === 'DRAFT' ? <><button className="text-button" onClick={() => onEdit?.(order)}>编辑</button><button className="text-button" onClick={() => onConfigureRoute?.(order.styleId)}>配置工艺</button><button className="text-button" disabled={releasingOrderId === order.id} onClick={() => onRelease?.(order)}>{releasingOrderId === order.id ? '下达中…' : '下达订单'}</button></> : <span>只读</span>}</div></td>}
    </tr>;
  })}</tbody></table></div>;
}

function orderStatusLabel(status: string): string {
  return ({ DRAFT: '草稿', RELEASED: '已下达', IN_PROGRESS: '生产中', COMPLETED: '已完成', CANCELLED: '已取消' } as Record<string, string>)[status] ?? status;
}

function orderStatusTone(status: string): string {
  return ({ DRAFT: 'neutral', RELEASED: 'warning', IN_PROGRESS: 'active', COMPLETED: 'active', CANCELLED: 'danger' } as Record<string, string>)[status] ?? 'neutral';
}
