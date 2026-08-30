(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { workerOpen: false, bundleStarted: false, bundleCompleted: false, income: 98.60 };
  let toastTimer;
  let scanTimer;

  function showToast(message) {
    const toast = $('#toast');
    $('span', toast).textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function showPage(name) {
    $$('.page').forEach(page => page.classList.toggle('active', page.dataset.page === name));
    $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.pageTarget === name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  $$('[data-page-target]').forEach(button => button.addEventListener('click', () => showPage(button.dataset.pageTarget)));

  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    if (!state.workerOpen) document.body.style.overflow = '';
  }

  $$('[data-close-modal]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.closeModal)));
  $$('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('click', event => {
    if (event.target === backdrop) closeModal(backdrop.id);
  }));

  function openDrawer(orderNo = 'PO-260526') {
    $('#drawerOrderNo').textContent = orderNo;
    $('#orderDrawer').classList.add('open');
    $('#orderDrawer').setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    $('#orderDrawer').classList.remove('open');
    $('#orderDrawer').setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  $$('[data-order]').forEach(element => element.addEventListener('click', event => {
    if (event.target.closest('input')) return;
    openDrawer(element.dataset.order);
  }));
  $$('[data-close-drawer]').forEach(button => button.addEventListener('click', closeDrawer));
  $('#orderDrawer').addEventListener('click', event => { if (event.target === $('#orderDrawer')) closeDrawer(); });

  function createSimpleForm(title, body, success) {
    const existing = $('#dynamicModal');
    if (existing) existing.remove();
    const wrapper = document.createElement('div');
    wrapper.id = 'dynamicModal';
    wrapper.className = 'modal-backdrop open';
    wrapper.setAttribute('aria-hidden', 'false');
    wrapper.innerHTML = `<div class="modal small-modal"><button class="modal-close" aria-label="关闭">×</button><div class="modal-kicker">原型操作</div><h2>${title}</h2><p>${body}</p><label style="display:block;margin:18px 0;font-size:11px;color:#718078">备注（选填）<input style="display:block;width:100%;height:44px;margin-top:6px;border:1px solid #e4e8e1;border-radius:11px;padding:0 12px" placeholder="输入备注"></label><button class="button primary full">确认</button></div>`;
    document.body.appendChild(wrapper);
    document.body.style.overflow = 'hidden';
    const close = () => { wrapper.remove(); document.body.style.overflow = ''; };
    $('.modal-close', wrapper).addEventListener('click', close);
    wrapper.addEventListener('click', event => { if (event.target === wrapper) close(); });
    $('.button.primary', wrapper).addEventListener('click', () => { close(); showToast(success); });
  }

  $('#newOrderButton').addEventListener('click', () => createSimpleForm('新建生产订单', '完整系统将包含客户、款式、颜色尺码、数量与交期录入。', '已创建示例订单草稿'));
  $('#newOrderButton2').addEventListener('click', () => createSimpleForm('新建生产订单', '完整系统将包含客户、款式、颜色尺码、数量与交期录入。', '已创建示例订单草稿'));
  $('#generateBundlesButton').addEventListener('click', () => createSimpleForm('生成扎包', '按床号 478、每扎 4 件生成剩余扎包，并自动复制款式工艺路线。', '已生成 3 个示例扎包'));
  $('#addWorkerButton').addEventListener('click', () => createSimpleForm('新增员工', '输入工号、姓名、班组后即可继续配置多个工种。', '已新增示例员工'));
  $('#confirmPayrollButton').addEventListener('click', () => createSimpleForm('确认本日计件', '确认后，员工端的“预计金额”将变为“已确认金额”。', '今日计件已确认'));

  $$('[data-toast]').forEach(button => button.addEventListener('click', () => showToast(button.dataset.toast)));
  $('#notificationButton').addEventListener('click', () => showToast('你有 3 条生产预警和 4 条待处理异常'));
  $('#profileButton').addEventListener('click', () => showToast('当前账号：林主管 · 生产主管'));
  $('#showAlerts').addEventListener('click', () => showToast('已打开异常中心：7 项待处理'));
  $('#viewAllAlerts').addEventListener('click', () => showToast('已打开全部生产风险'));
  $('#bedDetailsButton').addEventListener('click', () => showToast('床号 478：共 40 件，已生成 10 扎'));

  $$('.segmented button').forEach(button => button.addEventListener('click', () => {
    $$('.segmented button').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    showToast(`工序图表已切换为${button.textContent}`);
  }));

  function filterTable(input, table) {
    const term = input.value.trim().toLowerCase();
    $$('tbody tr', table).forEach(row => { row.hidden = !row.dataset.search.toLowerCase().includes(term); });
  }
  $('#orderSearch').addEventListener('input', event => filterTable(event.target, $('#ordersTable')));
  $('#workerSearch').addEventListener('input', event => filterTable(event.target, $('#workersTable')));

  $$('.card-check input').forEach(input => input.addEventListener('change', () => input.closest('.bundle-card').classList.toggle('selected', input.checked)));
  $$('.open-bundle').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    const card = button.closest('.bundle-card');
    showToast(`${card.dataset.bundle}：已打开完整流转记录`);
  }));

  function drawPrototypeQr() {
    const canvas = $('#qrCanvas');
    const ctx = canvas.getContext('2d');
    const size = 29;
    const scale = canvas.width / size;
    const cell = (x, y, fill = true) => { ctx.fillStyle = fill ? '#111' : '#fff'; ctx.fillRect(x * scale, y * scale, Math.ceil(scale), Math.ceil(scale)); };
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    let seed = 106052;
    const random = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (random() > .52) cell(x, y);
    const finder = (ox, oy) => {
      ctx.fillStyle = '#fff'; ctx.fillRect((ox - 1) * scale, (oy - 1) * scale, 9 * scale, 9 * scale);
      ctx.fillStyle = '#111'; ctx.fillRect(ox * scale, oy * scale, 7 * scale, 7 * scale);
      ctx.fillStyle = '#fff'; ctx.fillRect((ox + 1) * scale, (oy + 1) * scale, 5 * scale, 5 * scale);
      ctx.fillStyle = '#111'; ctx.fillRect((ox + 2) * scale, (oy + 2) * scale, 3 * scale, 3 * scale);
    };
    finder(2, 2); finder(20, 2); finder(2, 20);
  }

  function openPrint() { openModal('printModal'); drawPrototypeQr(); }
  $('#printSelectedButton').addEventListener('click', openPrint);
  $('#confirmPrint').addEventListener('click', () => { closeModal('printModal'); showToast('打印任务已发送到“裁床办公室 · TSC-01”'); });

  $$('.edit-skills').forEach(button => button.addEventListener('click', () => {
    $('#skillsWorkerName').textContent = button.dataset.worker;
    openModal('skillsModal');
  }));
  $$('.skills-editor input').forEach(input => input.addEventListener('change', () => {
    const select = $('select', input.closest('label'));
    select.disabled = !input.checked;
  }));
  $('#saveSkills').addEventListener('click', () => { closeModal('skillsModal'); showToast(`${$('#skillsWorkerName').textContent}的工种授权已更新`); });

  function openWorker() {
    state.workerOpen = true;
    $('#adminApp').style.display = 'none';
    $('#workerApp').classList.add('open');
    $('#workerApp').setAttribute('aria-hidden', 'false');
    document.body.style.overflow = '';
    showWorkerScreen('scan');
    window.scrollTo(0, 0);
  }

  function closeWorker() {
    state.workerOpen = false;
    $('#workerApp').classList.remove('open');
    $('#workerApp').setAttribute('aria-hidden', 'true');
    $('#adminApp').style.display = '';
    window.scrollTo(0, 0);
  }

  function showWorkerScreen(name) {
    $$('.worker-screen').forEach(screen => screen.classList.toggle('active', screen.dataset.workerScreen === name));
    $$('.worker-bottom-nav button').forEach(button => button.classList.toggle('active', button.dataset.workerTab === name || (name === 'bundle' && button.dataset.workerTab === 'scan')));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  $('#openWorkerApp').addEventListener('click', openWorker);
  $('#closeWorkerApp').addEventListener('click', closeWorker);
  $$('[data-worker-tab]').forEach(button => button.addEventListener('click', () => showWorkerScreen(button.dataset.workerTab)));

  function startScan() {
    $('#scannerResult').classList.remove('visible');
    openModal('scannerModal');
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => $('#scannerResult').classList.add('visible'), 1300);
  }
  $('#simulateScan').addEventListener('click', startScan);
  $('#manualCodeButton').addEventListener('click', () => createSimpleForm('输入卡片短码', '请输入卡片二维码下方的 6～10 位短码，例如 7K3P9X。', '已识别扎包 10605-2'));
  $('#useScanResult').addEventListener('click', () => { closeModal('scannerModal'); showWorkerScreen('bundle'); });

  $('#continueTask').addEventListener('click', () => showToast('已打开进行中的锁边任务'));
  $('#taskContinue').addEventListener('click', () => showToast('已打开进行中的锁边任务'));

  function updateReportButton() {
    const button = $('#reportButton');
    if (state.bundleCompleted) {
      button.textContent = '本工序已完成';
      button.disabled = true;
      $('#workerBundleStatus').textContent = '已完成';
      $('#workerBundleStatus').className = 'status-tag good';
    } else if (state.bundleStarted) {
      button.textContent = '完成上袖报工';
      button.classList.add('in-progress');
      $('#workerBundleStatus').textContent = '加工中';
      $('#workerBundleStatus').className = 'status-tag active';
    } else {
      button.textContent = '开始上袖';
    }
  }

  $('#reportButton').addEventListener('click', () => {
    if (!state.bundleStarted) {
      state.bundleStarted = true;
      updateReportButton();
      showToast('已开始上袖 · 服务器已记录开工时间');
      return;
    }
    if (!state.bundleCompleted) openModal('completeModal');
  });

  const quantityInputs = ['inputQty', 'goodQty', 'defectQty', 'missingQty'].map(id => document.getElementById(id));
  function validateQuantities() {
    const values = quantityInputs.map(input => Math.max(0, Number(input.value) || 0));
    const [input, good, defect, missing] = values;
    const valid = input === good + defect + missing;
    const message = $('#quantityValidation');
    message.textContent = valid ? `数量平衡：${input} = ${good} + ${defect} + ${missing}` : `数量不平：投入 ${input}，良品+次品+短缺为 ${good + defect + missing}`;
    message.classList.toggle('error', !valid);
    $('#completionFee').textContent = `¥${(good * .8).toFixed(2)}`;
    $('#confirmComplete').disabled = !valid;
    return { valid, good };
  }
  quantityInputs.forEach(input => input.addEventListener('input', validateQuantities));

  $('#confirmComplete').addEventListener('click', () => {
    const { valid, good } = validateQuantities();
    if (!valid) return;
    state.bundleCompleted = true;
    state.income += good * .8;
    const money = `¥${state.income.toFixed(2)}`;
    $('#todayIncome').textContent = money;
    $('#incomeDetailToday').textContent = money;
    const item = document.createElement('article');
    item.innerHTML = `<span class="income-process">上袖</span><div><strong>扎包 10605-2</strong><small>${good}件 × ¥0.80 · 刚刚</small></div><b>+¥${(good * .8).toFixed(2)}<small>待确认</small></b>`;
    $('#incomeList').prepend(item);
    closeModal('completeModal');
    updateReportButton();
    showToast(`报工成功，预计计件 +¥${(good * .8).toFixed(2)}`);
  });

  $('#exceptionButton').addEventListener('click', () => createSimpleForm('上报扎包异常', '可选择少片、次品、混码、色差或卡片损坏，提交后主管会收到提醒。', '异常已提交，扎包状态已设为待处理'));

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const openModalElement = $('.modal-backdrop.open');
    if (openModalElement) closeModal(openModalElement.id);
    if ($('#orderDrawer').classList.contains('open')) closeDrawer();
  });

  function applyDemoRoute() {
    if (window.location.hash === '#worker') {
      openWorker();
      showWorkerScreen('scan');
    }
    if (window.location.hash === '#bundle') {
      openWorker();
      showWorkerScreen('bundle');
    }
  }

  window.addEventListener('hashchange', applyDemoRoute);
  updateReportButton();
  applyDemoRoute();
})();
