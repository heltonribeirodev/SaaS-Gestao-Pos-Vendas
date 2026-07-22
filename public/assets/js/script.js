// ═══════════════════════════════════════════════
// ESTADO GLOBAL DO APLICATIVO E API CLIENT
// ═══════════════════════════════════════════════
let dataSET = [];
let filteredData = [];
let currentPage = 1;
const rowsPerPage = 10;
let currentSort = { col: 'id', asc: true };
let urgencyFilter = null; 
let currentUser = null;

const STATUS_OPTIONS = ['ENTREGUE', 'EM TRÂNSITO', 'EM ROTA'];

// Função base para todas as requisições API (já inclui os cookies de sessão do JWT)
async function apiFetch(endpoint, options = {}) {
  options.credentials = 'include';
  if (options.body && !(options.body instanceof FormData)) {
    options.headers = { ...options.headers, 'Content-Type': 'application/json' };
  }
  const res = await fetch(endpoint, options);
  
  if (res.status === 401) {
    sessionStorage.removeItem('fortecare_session');
    window.location.href = 'login.html';
    throw new Error('Não autorizado');
  }
  return res;
}

// ═══════════════════════════════════════════════
// UTILITÁRIOS & FORMATAÇÃO
// ═══════════════════════════════════════════════
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function calcPct(valorNF, valorC) {
  return valorNF > 0 ? +((valorC / valorNF) * 100).toFixed(2) : 0;
}

function findByRowId(rowId) {
  return dataSET.find(i => i._rowId === Number(rowId));
}

function parseBrDate(str) {
  if (!str || typeof str !== 'string' || !str.includes('/')) return null;
  const [d, m, y] = str.split('/').map(Number);
  if (!d || !m || !y) return null;
  const dt = new Date(y, m - 1, d);
  return isNaN(dt.getTime()) ? null : dt;
}

function todayMidnight() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

function isPending(item) {
  const s = (item.status || '').toUpperCase();
  return !s.startsWith('ENTREGUE') && !s.startsWith('CANCEL');
}

function getCurrentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getDashboardData() {
  const monthKey = getCurrentMonthKey();
  return dataSET.filter(i => (i.emissao || '').slice(0, 7) === monthKey);
}

function brToIso(str) {
  if (!str || !str.includes('/')) return '';
  const [d, m, y] = str.split('/');
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

function isoToBr(str) {
  if (!str || !str.includes('-')) return '';
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

function excelToIsoDate(value) {
  if (value === undefined || value === null || value === '') return '';
  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getFullYear(), m = String(value.getMonth() + 1).padStart(2, '0'), d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'number' && typeof XLSX !== 'undefined' && XLSX.SSF) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2,'0')}-${String(parsed.d).padStart(2,'0')}`;
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split('/');
    return `${y}-${m}-${d}`;
  }
  return '';
}

function excelToBrDate(value) {
  const iso = excelToIsoDate(value);
  if (iso) return isoToBr(iso);
  return typeof value === 'string' ? value.trim() : '';
}

let chartStatusInstance = null;
let chartVendInstance = null;
let chartTranspInstance = null;
const colors = { blue: '#1B6FD5', teal: '#00A878', amber: '#F59E0B', orange: '#F97316', red: '#EF4444', muted: '#6B7FA3', border: '#DDE6F5', navy: '#002B5C' };
const formatMoney = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

function getBadgeClass(status) {
  switch(String(status).toUpperCase()) {
    case 'ENTREGUE': return 'bE';
    case 'EM TRÂNSITO': return 'bT';
    case 'EM ROTA': return 'bR';
    default: return 'bT';
  }
}

// ═══════════════════════════════════════════════
// INICIALIZAÇÃO DA APLICAÇÃO & CARREGAMENTO DE DADOS
// ═══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const session = JSON.parse(sessionStorage.getItem('fortecare_session'));
    if (session) currentUser = session;
  } catch {}

  applyLoggedUser();
  await loadPedidosFromDB();
  
  const gSearch = document.getElementById('g-search');
  if (gSearch) {
    gSearch.addEventListener('input', (e) => {
      const fq = document.getElementById('f-q');
      if (fq) fq.value = e.target.value;
      applyFilters();
    });
  }
});

async function loadPedidosFromDB() {
  try {
    const res = await apiFetch('/api/pedidos/');
    const rawData = await res.json();
    
    // Mapeia do formato do PostgreSQL para o formato esperado pela UI
    dataSET = rawData.map((dbItem, index) => ({
      _rowId: index,
      _dbId: dbItem.id, // ID real do PostgreSQL para os PUT e DELETE
      id: dbItem.nf || `S/N-${dbItem.id}`, // A UI usa 'id' para mostrar a NF
      vendedor: dbItem.vendedor || 'NÃO INFORMADO',
      valorNF: dbItem.valor_nf || 0,
      valorC: dbItem.valor_frete || 0,
      pct: dbItem.pct_frete || calcPct(dbItem.valor_nf, dbItem.valor_frete),
      transportadora: dbItem.transportadora || 'NÃO INFORMADO',
      emissao: dbItem.emissao,
      destinatario: dbItem.destinatario || 'NÃO INFORMADO',
      uf: dbItem.uf || '',
      municipio: dbItem.municipio || '',
      previsao: dbItem.previsao ? isoToBr(dbItem.previsao) : '-',
      entrega: dbItem.entrega ? isoToBr(dbItem.entrega) : '',
      dias: dbItem.dias || 0,
      contato: dbItem.contato || '',
      status: dbItem.status || 'EM TRÂNSITO',
      obs: dbItem.obs || ''
    }));

    filteredData = [...dataSET];
    buildFilterDropdowns();
    executeDataRefresh();
  } catch (error) {
    showToast('Falha ao carregar dados do servidor.');
  }
}

function buildFilterDropdowns() {
  const vends = [...new Set(dataSET.map(i => i.vendedor))].sort();
  const transps = [...new Set(dataSET.map(i => i.transportadora))].sort();
  const ufs = [...new Set(dataSET.map(i => i.uf))].sort();

  const populate = (id, list, placeholder) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = `<option value="">${placeholder}</option>` + 
      list.map(v => `<option value="${v}">${v}</option>`).join('');
  };

  populate('f-vend', vends, 'Todos os Vendedores');
  populate('f-transp', transps, 'Todas as Transportadoras');
  populate('f-uf', ufs, 'Todos os Estados');
}

function executeDataRefresh() {
  renderDashboard();
  renderPedidos();
  const activeTab = document.querySelector('.tab.active');
  if (activeTab && activeTab.id === 'tab-transportadoras') renderTransportadoras();
  if (activeTab && activeTab.id === 'tab-vendedores') renderVendedores();
}

function showTab(tabId, element) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tabId).classList.add('active');

  document.querySelectorAll('.sb-nav li').forEach(li => li.classList.remove('active'));
  if (element) element.classList.add('active');

  const titles = { dashboard: 'Dashboard', pedidos: 'Pedidos', transportadoras: 'Transportadoras', vendedores: 'Vendedores', administracao: 'Administração' };
  document.getElementById('top-title').innerText = titles[tabId] || 'ForteCare';

  if (tabId === 'transportadoras') renderTransportadoras();
  if (tabId === 'vendedores') renderVendedores();
  if (tabId === 'administracao') {
    loadAndRenderUsersPanel();
    carregarDePara();
  }
}

// ═══════════════════════════════════════════════
// ENGINE DE FILTROS E DATAS (MANTIDO IGUAL)
// ═══════════════════════════════════════════════
function applyFilters() {
  const fStatus = document.getElementById('f-status').value.toUpperCase();
  const fVend = document.getElementById('f-vend').value;
  const fTransp = document.getElementById('f-transp').value;
  const fUf = document.getElementById('f-uf').value;
  const fQuery = document.getElementById('f-q').value.toLowerCase();
  const fFrom = document.getElementById('f-dfrom').value;
  const fTo = document.getElementById('f-dto').value;

  filteredData = dataSET.filter(item => {
    if (fStatus && item.status.toUpperCase() !== fStatus) return false;
    if (fVend && item.vendedor !== fVend) return false;
    if (fTransp && item.transportadora !== fTransp) return false;
    if (fUf && item.uf !== fUf) return false;
    if (fQuery) {
      const match = (item.destinatario || '').toLowerCase().includes(fQuery) || (item.municipio || '').toLowerCase().includes(fQuery) || String(item.id).toLowerCase().includes(fQuery);
      if (!match) return false;
    }
    if (fFrom && item.emissao < fFrom) return false;
    if (fTo && item.emissao > fTo) return false;
    if (urgencyFilter) {
      if (!isPending(item)) return false;
      const prev = parseBrDate(item.previsao);
      if (!prev) return false;
      const hoje = todayMidnight();
      if (urgencyFilter === 'hoje' && prev.getTime() !== hoje.getTime()) return false;
      if (urgencyFilter === 'atraso' && prev.getTime() >= hoje.getTime()) return false;
    }
    return true;
  });

  currentPage = 1;
  executeDataRefresh();
}

function goToUrgent(type) {
  showTab('pedidos', document.querySelector('.sb-nav li:nth-child(2)'));
  clearFilters();
  urgencyFilter = type;
  const tag = document.getElementById('urgency-tag');
  tag.style.display = 'inline-flex';
  tag.querySelector('.ptag-txt').innerText = type === 'hoje' ? 'A entregar hoje' : 'Em atraso';
  applyFilters();
}

function clearUrgencyFilter() {
  urgencyFilter = null;
  document.getElementById('urgency-tag').style.display = 'none';
  applyFilters();
}

function clearFilters() {
  document.getElementById('f-status').value = '';
  document.getElementById('f-vend').value = '';
  document.getElementById('f-transp').value = '';
  document.getElementById('f-uf').value = '';
  document.getElementById('f-q').value = '';
  document.getElementById('g-search').value = '';
  urgencyFilter = null;
  document.getElementById('urgency-tag').style.display = 'none';
  clearDateFilter();
}

function setPreset(preset, el) {
  document.querySelectorAll('.qchip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');

  const hoje = new Date();
  let de = new Date(), ate = new Date();

  switch(preset) {
    case 'hoje': break;
    case '7d': de.setDate(hoje.getDate() - 7); break;
    case 'semana': de.setDate(hoje.getDate() - hoje.getDay()); break;
    case 'mes': de = new Date(hoje.getFullYear(), hoje.getMonth(), 1); break;
    case 'mesant': de = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1); ate = new Date(hoje.getFullYear(), hoje.getMonth(), 0); break;
  }

  document.getElementById('f-dfrom').value = de.toISOString().split('T')[0];
  document.getElementById('f-dto').value = ate.toISOString().split('T')[0];
  
  const tag = document.getElementById('period-tag');
  tag.style.display = 'inline-flex';
  tag.querySelector('.ptag-txt').innerText = el ? el.innerText : 'Período customizado';
  applyFilters();
}

function onDateInput() {
  document.querySelectorAll('.qchip').forEach(c => c.classList.remove('active'));
  const tag = document.getElementById('period-tag');
  tag.style.display = 'inline-flex';
  tag.querySelector('.ptag-txt').innerText = 'Filtro por data';
  applyFilters();
}

function clearDateFilter() {
  document.getElementById('f-dfrom').value = '';
  document.getElementById('f-dto').value = '';
  document.getElementById('period-tag').style.display = 'none';
  document.querySelectorAll('.qchip').forEach(c => c.classList.remove('active'));
  applyFilters();
}

// ═══════════════════════════════════════════════
// RENDERIZADOR: DASHBOARD & GRÁFICOS
// ═══════════════════════════════════════════════
function renderDashboard() {
  const data = getDashboardData();
  const hoje = todayMidnight();
  const total = data.length;
  const entregues = data.filter(p => p.status.toUpperCase() === 'ENTREGUE').length;
  const emTransito = data.filter(p => p.status.toUpperCase() === 'EM TRÂNSITO').length;

  document.getElementById('kpi-total').innerText = total;
  document.getElementById('kpi-ent').innerText = entregues;
  document.getElementById('kpi-ent-pct').innerText = total > 0 ? Math.round((entregues / total) * 100) + '%' : '0%';
  document.getElementById('kpi-trans').innerText = emTransito;

  const mesNomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const agora = new Date();
  document.getElementById('chip-date').innerText = `${mesNomes[agora.getMonth()]} de ${agora.getFullYear()}`;

  const emissoesValidas = data.map(i => i.emissao).filter(Boolean).sort();
  const chipEmissao = document.getElementById('chip-last-emissao');
  if (emissoesValidas.length > 0) {
    chipEmissao.innerText = `Última emissão: ${formatDateToBr(emissoesValidas[emissoesValidas.length - 1])}`;
    chipEmissao.style.display = 'inline-flex';
  } else {
    chipEmissao.style.display = 'none';
  }

  let entregarHoje = 0, emAtraso = 0, entreguesNoPrazo = 0, entreguesAtrasados = 0;
  data.forEach(item => {
    const prev = parseBrDate(item.previsao);
    if (isPending(item)) {
      if (!prev) return;
      if (prev.getTime() === hoje.getTime()) entregarHoje++;
      else if (prev.getTime() < hoje.getTime()) emAtraso++;
      return;
    }
    if (item.status.toUpperCase() === 'ENTREGUE') {
      const entregaDate = parseBrDate(item.entrega);
      if (entregaDate && prev && entregaDate.getTime() > prev.getTime()) entreguesAtrasados++;
      else entreguesNoPrazo++;
    }
  });

  document.getElementById('kpi-hoje').innerText = entregarHoje;
  document.getElementById('kpi-atraso').innerText = emAtraso;
  document.getElementById('card-atraso').classList.toggle('is-alert', emAtraso > 0);
  document.getElementById('card-hoje').classList.toggle('is-alert', entregarHoje > 0);
  document.getElementById('kpi-atrasos-total').innerText = (emAtraso + entreguesAtrasados);

  const baseSLA = entreguesNoPrazo + entreguesAtrasados + emAtraso;
  const nivelServico = baseSLA > 0 ? Math.round((entreguesNoPrazo / baseSLA) * 100) : null;
  const slaEl = document.getElementById('kpi-sla');
  const slaCard = document.getElementById('card-sla');
  if (nivelServico === null) {
    slaEl.innerText = '–';
    slaCard.classList.remove('sla-bad', 'sla-warn', 'sla-good');
  } else {
    slaEl.innerText = nivelServico + '%';
    slaCard.classList.remove('sla-bad', 'sla-warn', 'sla-good');
    if (nivelServico < 80) slaCard.classList.add('sla-bad');
    else if (nivelServico < 95) slaCard.classList.add('sla-warn');
    else slaCard.classList.add('sla-good');
  }

  const totalValorNFmes = data.reduce((acc, i) => acc + (i.valorNF || 0), 0);
  const totalFretemes = data.reduce((acc, i) => acc + (i.valorC || 0), 0);
  const freteMedio = totalValorNFmes > 0 ? (totalFretemes / totalValorNFmes) * 100 : null;
  document.getElementById('kpi-frete').innerText = freteMedio === null ? '–' : freteMedio.toFixed(1) + '%';

  const rBody = document.getElementById('r-body');
  if (data.length === 0) {
    rBody.innerHTML = `<tr><td colspan="8" class="empty">Nenhum registro com emissão no mês atual.</td></tr>`;
  } else {
    rBody.innerHTML = [...data].sort((a,b) => b.emissao.localeCompare(a.emissao)).slice(0, 5).map(item => `
      <tr>
        <td class="td-mono">${item.id}</td>
        <td>${item.vendedor}</td>
        <td class="td-dest" title="${item.destinatario}">${item.destinatario}</td>
        <td>${item.uf}</td>
        <td>${item.transportadora}</td>
        <td class="td-money">${formatMoney(item.valorNF)}</td>
        <td>${item.previsao}</td>
        <td><span class="badge ${getBadgeClass(item.status)}"><div class="bd"></div>${item.status}</span></td>
      </tr>
    `).join('');
  }

  renderChartsEngine(data);
}

function renderChartsEngine(data) {
  if (chartStatusInstance) chartStatusInstance.destroy();
  if (chartVendInstance) chartVendInstance.destroy();
  if (chartTranspInstance) chartTranspInstance.destroy();

  const statusCounts = { 'ENTREGUE': 0, 'EM TRÂNSITO': 0, 'EM ROTA': 0};
  data.forEach(i => {
    let s = i.status.toUpperCase();
    if (statusCounts[s] !== undefined) statusCounts[s]++;
  });

  const ctxStatus = document.getElementById('c-status');
  if (ctxStatus) {
    chartStatusInstance = new Chart(ctxStatus, {
      type: 'doughnut',
      data: { labels: Object.keys(statusCounts), datasets: [{ data: Object.values(statusCounts), backgroundColor: [colors.teal, colors.amber, colors.orange, colors.red], borderWidth: 2, hoverOffset: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
    const total = data.length;
    document.getElementById('status-legend').innerHTML = Object.keys(statusCounts).map((key, index) => {
      const color = [colors.teal, colors.amber, colors.orange, colors.red][index];
      const count = statusCounts[key];
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      return `<div class="sl-row"><div class="sl-left"><div class="sl-dot" style="background:${color}"></div>${key}</div><div class="sl-count">${count} <span style="color:var(--muted);font-weight:400">(${pct}%)</span></div></div>`;
    }).join('');
  }

  const vendData = {};
  data.forEach(i => { vendData[i.vendedor] = (vendData[i.vendedor] || 0) + i.valorNF; });
  const ctxVend = document.getElementById('c-vend');
  if (ctxVend) {
    chartVendInstance = new Chart(ctxVend, {
      type: 'bar',
      data: { labels: Object.keys(vendData), datasets: [{ label: 'Faturamento', data: Object.values(vendData), backgroundColor: colors.blue, borderRadius: 6 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { grid: { display: false }, ticks: { font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } } }
    });
  }

  const transpData = {};
  data.forEach(i => { transpData[i.transportadora] = (transpData[i.transportadora] || 0) + 1; });
  const ctxTransp = document.getElementById('c-transp');
  if (ctxTransp) {
    chartTranspInstance = new Chart(ctxTransp, {
      type: 'polarArea',
      data: { labels: Object.keys(transpData), datasets: [{ data: Object.values(transpData), backgroundColor: [colors.blue + 'CC', colors.teal + 'CC', colors.amber + 'CC', colors.orange + 'CC'] }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { r: { ticks: { display: false } } } }
    });
  }
}

// ═══════════════════════════════════════════════
// RENDERIZADOR: TELA PRINCIPAL DE PEDIDOS E CRUD API
// ═══════════════════════════════════════════════
function renderPedidos() {
  const pBody = document.getElementById('p-body');
  if (!pBody) return;

  if (filteredData.length === 0) {
    pBody.innerHTML = `<tr><td colspan="15" class="empty"><div class="empty-ic">🔍</div><div class="empty-txt">Nenhum pedido atende aos filtros aplicados.</div></td></tr>`;
    document.getElementById('t-count').innerText = `0 registros`;
    document.getElementById('pag').innerHTML = '';
    return;
  }

  filteredData.sort((a, b) => {
    let valA = a[currentSort.col];
    let valB = b[currentSort.col];
    if (typeof valA === 'string') return currentSort.asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    else return currentSort.asc ? valA - valB : valB - valA;
  });

  const idxStart = (currentPage - 1) * rowsPerPage;
  const paginatedItems = filteredData.slice(idxStart, idxStart + rowsPerPage);

  pBody.innerHTML = paginatedItems.map(item => `
    <tr>
      <td class="td-mono">${item.id}</td>
      <td style="font-weight:500">${item.vendedor}</td>
      <td class="td-dest" title="${item.destinatario}">${item.destinatario}</td>
      <td><span style="font-weight:700; color:var(--navy)">${item.uf}</span></td>
      <td class="td-ct" title="${item.municipio}">${item.municipio}</td>
      <td>${item.transportadora}</td>
      <td>${formatDateToBr(item.emissao)}</td>
      <td class="td-money">${formatMoney(item.valorNF)}</td>
      <td>${item.previsao}</td>
      <td>
        <input type="date" class="entrega-edit-input" value="${brToIso(item.entrega)}"
               onchange="updatePedidoAPI(${item._rowId}, { entrega: this.value })">
      </td>
      <td>
        <input type="text" class="contato-edit-input" value="${escapeHtml(item.contato)}"
               placeholder="Sem contato" onchange="updatePedidoAPI(${item._rowId}, { contato: this.value })">
      </td>
      <td>
        <div class="frete-edit-wrap">
          <input type="number" step="0.01" min="0" class="frete-edit-input"
                 value="${item.valorC ?? 0}"
                 onchange="updatePedidoAPI(${item._rowId}, { valor_frete: this.value })">
          <span class="frete-pct" title="% de frete calculado">${calcPct(item.valorNF, item.valorC).toFixed(1)}%</span>
        </div>
      </td>
      <td>
        <select class="status-edit ${getBadgeClass(item.status)}" onchange="updatePedidoAPI(${item._rowId}, { status: this.value })">
          ${STATUS_OPTIONS.map(s => `<option value="${s}" ${item.status.toUpperCase() === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </td>
      <td>
        <div class="obs-edit-wrap">
          <input type="text" class="obs-edit-input" id="obs-${item._rowId}"
                 value="${escapeHtml(item.obs)}" placeholder="Sem observação"
                 onchange="updatePedidoAPI(${item._rowId}, { obs: this.value })">
          ${item.obs ? `<span class="obs-edit-clear" title="Remover observação" onclick="clearObs(${item._rowId})">✕</span>` : ''}
        </div>
      </td>
      <td>
        <button class="delete-btn" title="Excluir registro" onclick="deleteRecord(${item._rowId})">🗑</button>
      </td>
    </tr>
  `).join('');

  document.getElementById('t-count').innerText = `${filteredData.length} registros`;
  buildPaginationControls();
}

async function updatePedidoAPI(rowId, updatePayload) {
  const item = findByRowId(rowId);
  if (!item) return;

  try {
    const res = await apiFetch(`/api/pedidos/${item._dbId}`, {
      method: 'PUT',
      body: JSON.stringify(updatePayload)
    });

    if (res.ok) {
      // Sincroniza estado local com o sucesso
      if (updatePayload.status !== undefined) item.status = updatePayload.status;
      if (updatePayload.obs !== undefined) item.obs = updatePayload.obs;
      if (updatePayload.contato !== undefined) item.contato = updatePayload.contato;
      if (updatePayload.entrega !== undefined) item.entrega = isoToBr(updatePayload.entrega);
      if (updatePayload.valor_frete !== undefined) {
        item.valorC = parseFloat(updatePayload.valor_frete) || 0;
        item.pct = calcPct(item.valorNF, item.valorC);
      }
      
      executeDataRefresh();
      showToast('Alteração salva no banco de dados.');
    } else {
      const data = await res.json();
      showToast(data.detail || 'Erro ao atualizar.');
    }
  } catch (err) {
    showToast('Falha na comunicação com o servidor.');
  }
}

function clearObs(rowId) {
  const input = document.getElementById('obs-' + rowId);
  if (input) input.value = '';
  updatePedidoAPI(rowId, { obs: '' });
}

async function deleteRecord(rowId) {
  const item = findByRowId(rowId);
  if (!item) return;
  if (!confirm(`Excluir o pedido #${item.id} (${item.destinatario}) do banco de dados? Essa ação não pode ser desfeita.`)) return;

  try {
    const res = await apiFetch(`/api/pedidos/${item._dbId}`, { method: 'DELETE' });
    if (res.ok) {
      dataSET = dataSET.filter(i => i._rowId !== Number(rowId));
      applyFilters();
      showToast('Registro excluído permanentemente.');
    } else {
      showToast('Erro ao excluir pedido.');
    }
  } catch (err) {
    showToast('Falha na comunicação com o servidor.');
  }
}

function formatDateToBr(str) {
  if(!str || !str.includes('-')) return str;
  const parts = str.split('-');
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function buildPaginationControls() {
  const pagContainer = document.getElementById('pag');
  const totalPages = Math.ceil(filteredData.length / rowsPerPage);
  if (totalPages <= 1) { pagContainer.innerHTML = ''; return; }

  let html = `<button class="pb" ${currentPage === 1 ? 'disabled' : ''} onclick="changePage(${currentPage - 1})">‹</button>`;
  const delta = 2, pages = new Set();
  pages.add(1); pages.add(totalPages);
  for (let i = Math.max(2, currentPage - delta); i <= Math.min(totalPages - 1, currentPage + delta); i++) pages.add(i);
  const sorted = [...pages].sort((a, b) => a - b);
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) html += `<span class="pb pb-ellipsis">…</span>`;
    html += `<button class="pb ${currentPage === p ? 'on' : ''}" onclick="changePage(${p})">${p}</button>`;
    prev = p;
  }
  html += `<button class="pb" ${currentPage === totalPages ? 'disabled' : ''} onclick="changePage(${currentPage + 1})">›</button>`;
  pagContainer.innerHTML = html;
}

function changePage(p) { currentPage = p; renderPedidos(); }
function sortBy(columnKey) {
  if (currentSort.col === columnKey) currentSort.asc = !currentSort.asc;
  else { currentSort.col = columnKey; currentSort.asc = true; }
  renderPedidos();
}

// ═══════════════════════════════════════════════
// INCLUSÃO MANUAL API
// ═══════════════════════════════════════════════
function openManualModal() {
  document.getElementById('m-emissao').value = new Date().toISOString().split('T')[0];
  document.getElementById('m-nf').value = '';
  document.getElementById('m-vendedor').value = '';
  document.getElementById('m-destinatario').value = '';
  document.getElementById('m-uf').value = '';
  document.getElementById('m-municipio').value = '';
  document.getElementById('m-transportadora').value = '';
  document.getElementById('m-previsao').value = '';
  document.getElementById('m-valornf').value = '';
  document.getElementById('m-valorfrete').value = '';
  document.getElementById('m-status').value = 'EM TRÂNSITO';
  document.getElementById('m-contato').value = '';
  document.getElementById('m-obs').value = '';
  document.getElementById('manual-modal-error').style.display = 'none';
  document.getElementById('manual-overlay').classList.add('open');
  document.getElementById('m-nf').focus();
}
function closeManualModal() { document.getElementById('manual-overlay').classList.remove('open'); }

async function saveManualPedido() {
  const errorEl = document.getElementById('manual-modal-error');
  errorEl.style.display = 'none';

  const nf = document.getElementById('m-nf').value.trim();
  const vend = document.getElementById('m-vendedor').value.trim().toUpperCase();
  const dest = document.getElementById('m-destinatario').value.trim().toUpperCase();
  const uf = document.getElementById('m-uf').value.trim().toUpperCase();
  const mun = document.getElementById('m-municipio').value.trim().toUpperCase();
  const transp = document.getElementById('m-transportadora').value.trim().toUpperCase();
  const emissao = document.getElementById('m-emissao').value;
  const prev = document.getElementById('m-previsao').value;
  const valor_nf = parseFloat(document.getElementById('m-valornf').value) || 0;
  const valor_frete = parseFloat(document.getElementById('m-valorfrete').value) || 0;

  if (!nf || !vend || !dest || !uf || !transp || !emissao) {
    errorEl.innerText = 'Preencha os campos obrigatórios: NF, Vendedor, Destinatário, UF, Transportadora e Emissão.';
    errorEl.style.display = 'block';
    return;
  }

  const payload = {
    nf, vendedor: vend, valor_nf, valor_frete, pct_frete: calcPct(valor_nf, valor_frete),
    transportadora: transp, emissao, destinatario: dest, uf, municipio: mun,
    previsao: prev || null, contato: document.getElementById('m-contato').value.trim(),
    status: document.getElementById('m-status').value, obs: document.getElementById('m-obs').value.trim()
  };

  try {
    const res = await apiFetch('/api/pedidos/', { method: 'POST', body: JSON.stringify(payload) });
    if (res.ok) {
      await loadPedidosFromDB(); // Recarrega os dados com os IDs oficiais
      closeManualModal();
      showToast(`Pedido #${nf} incluído com sucesso no banco!`);
      showTab('pedidos', document.querySelector('.sb-nav li:nth-child(2)'));
    } else {
      const err = await res.json();
      errorEl.innerText = err.detail || 'Erro ao salvar no banco.';
      errorEl.style.display = 'block';
    }
  } catch (e) {
    errorEl.innerText = 'Falha na comunicação com o servidor.';
    errorEl.style.display = 'block';
  }
}

// ═══════════════════════════════════════════════
// IMPORTAÇÃO EXCEL PARA A API & EXPORTAÇÃO CSV
// ═══════════════════════════════════════════════
function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  const ext = file.name.split('.').pop().toLowerCase();
  const isCSV = ext === 'csv';
  const reader = new FileReader();

  reader.onload = async function(evt) {
    try {
      let rawRows = [];
      if (isCSV) {
        const text = evt.target.result;
        const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
        if (lines.length < 2) { showToast("CSV vazio ou sem dados."); return; }
        const sep = lines[0].includes(';') ? ';' : ',';
        const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, ''));
        rawRows = lines.slice(1).map(line => {
          const cols = []; let cur = '', inQ = false;
          for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') { inQ = !inQ; continue; }
            if (c === sep && !inQ) { cols.push(cur.trim()); cur = ''; continue; }
            cur += c;
          }
          cols.push(cur.trim());
          const obj = {}; headers.forEach((h, i) => { obj[h] = cols[i] ?? ''; });
          return obj;
        });
      } else {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
      }

      if (rawRows.length === 0) { showToast("O arquivo importado está vazio."); return; }

      const parseBR = (v) => v ? parseFloat(String(v).replace(/\./g, '').replace(',', '.')) || 0 : 0;
      
      const payloadLote = rawRows.map(r => {
        const vNF = parseBR(r['Valor NF'] || r['VALOR'] || r['Valor']);
        const vC = parseBR(r['Valor Frete'] || r['Frete'] || r['Custo']);
        return {
          nf: String(r['NF'] || r['#NF'] || r['Nota'] || ''),
          vendedor: String(r['Vendedor'] || r['VENDEDOR'] || 'NÃO INFORMADO').toUpperCase().trim(),
          valor_nf: vNF, valor_frete: vC, pct_frete: calcPct(vNF, vC),
          transportadora: String(r['Transportadora'] || r['TRANSPORTADORA'] || 'RETIRA').toUpperCase().trim(),
          emissao: excelToIsoDate(r['Emissão'] || r['Emissao'] || r['Data Emissão'] || r['Data Emissao']) || new Date().toISOString().split('T')[0],
          destinatario: String(r['Destinatário'] || r['Destinatario'] || r['Cliente'] || 'NÃO INFORMADO').toUpperCase().trim(),
          uf: String(r['UF'] || r['Estado'] || '').toUpperCase().trim(),
          municipio: String(r['Município'] || r['Municipio'] || r['Cidade'] || '').toUpperCase().trim(),
          previsao: excelToIsoDate(r['Previsão'] || r['Previsao'] || r['Entrega Prevista']),
          entrega: excelToIsoDate(r['Entrega'] || r['Data Entregue']),
          dias: parseInt(r['Dias'] || 0) || 0,
          contato: r['Contato'] || r['Email'] || '',
          status: String(r['Status'] || 'EM TRÂNSITO').toUpperCase().trim(),
          obs: r['Obs'] || r['Observação'] || r['Observacao'] || ''
        };
      });

      // Dispara importação para a API
      document.getElementById('import-ok').innerText = `Enviando para o banco de dados...`;
      document.getElementById('import-ok').style.display = 'block';

      const res = await apiFetch('/api/pedidos/importar', { method: 'POST', body: JSON.stringify({ pedidos: payloadLote }) });
      
      if (res.ok) {
        await loadPedidosFromDB();
        const apiResp = await res.json();
        document.getElementById('import-ok').innerText = `Sucesso! ${apiResp.inseridos} registros importados.`;
        showToast("Base de dados atualizada com sucesso!");
        setTimeout(() => {
          closeModal();
          document.getElementById('import-ok').style.display = 'none';
          document.getElementById('f-file').value = '';
        }, 1500);
      } else {
        const err = await res.json();
        showToast(err.detail || "Falha ao importar no servidor.");
        document.getElementById('import-ok').style.display = 'none';
      }
    } catch (err) { alert("Falha ao processar o arquivo."); }
  };
  if (isCSV) reader.readAsText(file, 'windows-1252'); else reader.readAsArrayBuffer(file);
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[;"\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function exportCSV() {
  if(filteredData.length === 0) { showToast("Sem dados ativos para exportar."); return; }
  const headers = ['#NF', 'Vendedor', 'Destinatario', 'UF', 'Municipio', 'Transportadora', 'Emissao', 'ValorNF', 'ValorFrete', 'PercFrete', 'Previsao', 'DataEntregue', 'Contato', 'Status', 'Obs'];
  const rows = filteredData.map(i => [ i.id, i.vendedor, i.destinatario, i.uf, i.municipio, i.transportadora, i.emissao, i.valorNF, i.valorC, calcPct(i.valorNF, i.valorC), i.previsao, i.entrega, i.contato, i.status, i.obs ].map(csvEscape).join(';'));
  const csvContent = "\uFEFF" + headers.join(';') + "\n" + rows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.setAttribute("href", url); link.setAttribute("download", `fortecare_export_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
  showToast(`${filteredData.length} registro(s) exportado(s).`);
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.innerText = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}
function openModal() { document.getElementById('overlay').classList.add('open'); }
function closeModal() { document.getElementById('overlay').classList.remove('open'); }

// ═══════════════════════════════════════════════
// AUTENTICAÇÃO E GESTÃO DE USUÁRIOS API
// ═══════════════════════════════════════════════
const TIPOS_USUARIO = ['Administrador','Gerente de Logística', 'Gerente', 'Operador', 'Vendedor'];

function applyLoggedUser() {
  if (!currentUser) return;
  const initials = currentUser.nome.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase();
  document.getElementById('user-av').innerText = initials || '?';
  document.getElementById('user-name').innerText = currentUser.nome;
  document.getElementById('user-role').innerText = currentUser.tipo;
  document.getElementById('user-pill').setAttribute('data-tooltip', `${currentUser.nome} — ${currentUser.tipo} (clique para sair)`);

  const adminMenuItem = document.querySelector('.sb-nav li[data-tooltip="Administração"]');
  if (adminMenuItem) {
    adminMenuItem.style.display = currentUser.tipo === 'Administrador' ? 'flex' : 'none';
    if (currentUser.tipo !== 'Administrador' && document.getElementById('tab-administracao')?.classList.contains('active')) {
      showTab('dashboard', document.querySelector('.sb-nav li:nth-child(1)'));
    }
  }

  // ── Restrições para Vendedor ─────────────────────────────────
  if (currentUser.tipo === 'Vendedor') {
    // Esconde botões de importar planilha e incluir manual
    document.querySelectorAll('[onclick="openModal()"], [onclick="openManualModal()"]').forEach(el => {
      el.style.display = 'none';
    });
    // Esconde filtro de vendedor (vendedor só vê os próprios pedidos)
    const fVend = document.getElementById('f-vend');
    if (fVend) fVend.closest('select') && (fVend.style.display = 'none');
    // Esconde botão exportar CSV
    const btnExport = document.querySelector('[onclick="exportCSV()"]');
    if (btnExport) btnExport.style.display = 'none';
  }
}

async function logout() {
  if (!currentUser) return;
  if (!confirm('Deseja sair do sistema?')) return;
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {} // Força a limpeza local mesmo se falhar
  currentUser = null;
  sessionStorage.removeItem('fortecare_session');
  window.location.replace('login.html');
}

// ── CRUD DE USUÁRIOS (aba Administração via API) ───────
async function loadAndRenderUsersPanel() {
  const card = document.getElementById('admin-users-card');
  if (!card) return;

  if (!currentUser || currentUser.tipo !== 'Administrador') {
    card.innerHTML = `<div class="chart-title" style="margin-bottom:12px">Gestão de Usuários</div><p style="font-size:13px;color:var(--muted)">Acesso restrito a usuários do tipo Administrador.</p>`;
    return;
  }

  card.innerHTML = `Carregando usuários do banco de dados...`;

  try {
    const res = await apiFetch('/api/usuarios/');
    const users = await res.json();
    
    // Anexa a lista na window para edição
    window.loadedUsers = users;

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div class="chart-title" style="margin:0">Gestão de Usuários</div>
        <button class="btn btn-primary" style="font-size:12px" onclick="openUserModal()">+ Novo Usuário</button>
      </div>
      <div class="t-scroll">
        <table>
          <thead><tr><th>Nome</th><th>E-mail</th><th>Setor</th><th>Tipo</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody>
            ${users.map(u => `
              <tr>
                <td>${escapeHtml(u.nome)}</td>
                <td>${escapeHtml(u.email)}</td>
                <td>${escapeHtml(u.setor)}</td>
                <td><span class="badge bT">${escapeHtml(u.tipo)}</span></td>
                <td><span class="badge ${u.ativo ? 'bE' : 'bR'}">${u.ativo ? 'Ativo' : 'Inativo'}</span></td>
                <td>
                  <button class="delete-btn" title="Editar usuário" onclick="openUserModal(${u.id})">✏️</button>
                  <button class="delete-btn" title="Excluir usuário" onclick="deleteUser(${u.id})">🗑</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    card.innerHTML = `Falha ao carregar a lista de usuários.`;
  }
}

function openUserModal(id) {
  const isEdit = !!id;
  document.getElementById('user-modal-title').innerText = isEdit ? 'Editar Usuário' : 'Novo Usuário';
  document.getElementById('user-modal-error').style.display = 'none';
  document.getElementById('u-edit-id').value = id || '';

  if (isEdit && window.loadedUsers) {
    const user = window.loadedUsers.find(u => u.id === id);
    if (!user) return;
    document.getElementById('u-nome').value = user.nome;
    document.getElementById('u-email').value = user.email;
    document.getElementById('u-senha').value = '';
    document.getElementById('u-setor').value = user.setor;
    document.getElementById('u-tipo').value = user.tipo;
    document.getElementById('u-senha-hint').innerText = '(deixe em branco para manter a senha atual)';
  } else {
    document.getElementById('u-nome').value = '';
    document.getElementById('u-email').value = '';
    document.getElementById('u-senha').value = '';
    document.getElementById('u-setor').value = '';
    document.getElementById('u-tipo').value = 'Operador';
    document.getElementById('u-senha-hint').innerText = '';
  }
  document.getElementById('user-overlay').classList.add('open');
}

function closeUserModal() { document.getElementById('user-overlay').classList.remove('open'); }

async function saveUser() {
  const editId = document.getElementById('u-edit-id').value;
  const nome = document.getElementById('u-nome').value.trim();
  const email = document.getElementById('u-email').value.trim().toLowerCase();
  const senha = document.getElementById('u-senha').value;
  const setor = document.getElementById('u-setor').value.trim();
  const tipo = document.getElementById('u-tipo').value;
  const errorEl = document.getElementById('user-modal-error');

  if (!nome || !email || !setor || !tipo || (!editId && !senha)) {
    errorEl.innerText = 'Preencha todos os campos obrigatórios.'; errorEl.style.display = 'block'; return;
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    errorEl.innerText = 'Informe um e-mail válido.'; errorEl.style.display = 'block'; return;
  }
  if (senha && senha.length < 6) {
    errorEl.innerText = 'A senha precisa ter ao menos 6 caracteres.'; errorEl.style.display = 'block'; return;
  }

  const payload = { nome, email, setor, tipo };
  if (senha) payload.senha = senha;

  try {
    const endpoint = editId ? `/api/usuarios/${editId}` : '/api/usuarios/';
    const method = editId ? 'PUT' : 'POST';
    
    const res = await apiFetch(endpoint, { method, body: JSON.stringify(payload) });

    if (res.ok) {
      closeUserModal();
      showToast('Usuário salvo no banco.');
      loadAndRenderUsersPanel();
    } else {
      const err = await res.json();
      errorEl.innerText = err.detail || 'Erro ao salvar usuário.';
      errorEl.style.display = 'block';
    }
  } catch(e) {
    errorEl.innerText = 'Falha na comunicação com o servidor.';
    errorEl.style.display = 'block';
  }
}

async function deleteUser(id) {
  if (currentUser && currentUser.id === id) { alert('Você não pode excluir o próprio usuário logado.'); return; }
  if (!confirm(`Tem certeza que deseja excluir permanentemente este usuário do banco de dados?`)) return;

  try {
    const res = await apiFetch(`/api/usuarios/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Usuário excluído.');
      loadAndRenderUsersPanel();
    } else {
      const err = await res.json();
      alert(err.detail || 'Erro ao excluir usuário.');
    }
  } catch(e) { showToast('Falha na comunicação com o servidor.'); }
}

// ═══════════════════════════════════════════════
// ABAS DE PERFORMANCE (MANTIDAS IGUAIS)
// ═══════════════════════════════════════════════
function renderTransportadoras() {
  const grid = document.getElementById('transp-grid');
  if(!grid) return;
  const dFrom = document.getElementById('f-transp-from')?.value, dTo = document.getElementById('f-transp-to')?.value, hoje = todayMidnight(), transportadoras = {};

  dataSET.forEach(p => {
    if (dFrom && p.emissao < dFrom) return;
    if (dTo && p.emissao > dTo) return;
    const t = p.transportadora;
    if(!transportadoras[t]) transportadoras[t] = { name: t, total: 0, entregues: 0, transito: 0, faturamento: 0, frete: 0, noPrazo: 0, atraso: 0 };
    transportadoras[t].total++; transportadoras[t].faturamento += (p.valorNF || 0); transportadoras[t].frete += (p.valorC || 0);
    if(p.status.toUpperCase() === 'ENTREGUE') {
      transportadoras[t].entregues++;
      const entregaDt = parseBrDate(p.entrega), previsaoDt = parseBrDate(p.previsao);
      if (entregaDt && previsaoDt && entregaDt.getTime() > previsaoDt.getTime()) transportadoras[t].atraso++;
      else transportadoras[t].noPrazo++;
    } else if (p.status.toUpperCase() === 'EM TRÂNSITO') { transportadoras[t].transito++; }
    if (isPending(p)) {
       const previsaoDt = parseBrDate(p.previsao);
       if (previsaoDt && previsaoDt.getTime() < hoje.getTime()) transportadoras[t].atraso++;
    }
  });

  grid.innerHTML = Object.values(transportadoras).map(t => {
    const baseSLA = t.noPrazo + t.atraso, sla = baseSLA > 0 ? Math.round((t.noPrazo / baseSLA) * 100) : 100;
    const kpiFrete = t.faturamento > 0 ? ((t.frete / t.faturamento) * 100).toFixed(1) : 0;
    const iniciais = t.name.split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase();
    return `
      <div class="perf-card">
        <div class="perf-header"><div class="perf-av" style="background:var(--navy)">${iniciais}</div><div><div class="perf-name">${t.name}</div><div class="perf-count">${t.total} envios registrados</div></div></div>
        <div class="perf-stats">
          <div class="ps-block" style="background:var(--teal-pale);color:#006B4C"><div class="ps-val">${t.noPrazo}</div><div class="ps-lbl">No Prazo</div></div>
          <div class="ps-block" style="background:var(--red-pale);color:#991B1B"><div class="ps-val">${t.atraso}</div><div class="ps-lbl">Atraso</div></div>
          <div class="ps-block" style="background:var(--amber-pale);color:#92660A"><div class="ps-val">${t.transito}</div><div class="ps-lbl">Curso</div></div>
        </div>
        <div class="pbar-wrap"><div class="pbar-top"><span class="pbar-lbl">Nível de Serviço</span><strong>${sla}%</strong></div><div class="pbar-bg"><div class="pbar-fill" style="width:${sla}%; background:var(--teal)"></div></div></div>
        <div style="margin-top:14px; font-size:12px; display:flex; flex-direction:column; gap:4px; border-top:1px solid var(--border); padding-top:10px;">
          <div style="display:flex; justify-content:space-between;"><span style="color:var(--muted)">Faturamento:</span><strong style="color:var(--text)">${formatMoney(t.faturamento)}</strong></div>
          <div style="display:flex; justify-content:space-between;"><span style="color:var(--muted)">Total Frete:</span><strong style="color:var(--text)">${formatMoney(t.frete)}</strong></div>
          <div style="display:flex; justify-content:space-between;"><span style="color:var(--muted)">KPI % Frete:</span><strong style="color:var(--blue)">${kpiFrete}%</strong></div>
        </div>
      </div>`;
  }).join('');
}

function renderVendedores() {
  const grid = document.getElementById('vend-grid');
  if(!grid) return;
  const dFrom = document.getElementById('f-vend-from')?.value, dTo = document.getElementById('f-vend-to')?.value, hoje = todayMidnight(), vendedores = {};

  dataSET.forEach(p => {
    if (dFrom && p.emissao < dFrom) return;
    if (dTo && p.emissao > dTo) return;
    const v = p.vendedor;
    if(!vendedores[v]) vendedores[v] = { name: v, pedidos: 0, faturamento: 0, frete: 0, entregues: 0, noPrazo: 0, atraso: 0 };
    vendedores[v].pedidos++; vendedores[v].faturamento += (p.valorNF || 0); vendedores[v].frete += (p.valorC || 0);
    if(p.status.toUpperCase() === 'ENTREGUE') {
      vendedores[v].entregues++;
      const entregaDt = parseBrDate(p.entrega), previsaoDt = parseBrDate(p.previsao);
      if (entregaDt && previsaoDt && entregaDt.getTime() > previsaoDt.getTime()) vendedores[v].atraso++; else vendedores[v].noPrazo++;
    }
    if (isPending(p)) {
       const previsaoDt = parseBrDate(p.previsao);
       if (previsaoDt && previsaoDt.getTime() < hoje.getTime()) vendedores[v].atraso++;
    }
  });

  const maiorFaturamento = Math.max(...Object.values(vendedores).map(v => v.faturamento), 1);
  grid.innerHTML = Object.values(vendedores).map(v => {
    const pctVolumeTotal = Math.round((v.faturamento / maiorFaturamento) * 100), ticketMedio = v.pedidos > 0 ? (v.faturamento / v.pedidos) : 0, baseSLA = v.noPrazo + v.atraso, sla = baseSLA > 0 ? Math.round((v.noPrazo / baseSLA) * 100) : 100, kpiFrete = v.faturamento > 0 ? ((v.frete / v.faturamento) * 100).toFixed(1) : 0, iniciais = v.name.split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase();
    return `
      <div class="perf-card">
        <div class="perf-header"><div class="perf-av" style="background:var(--blue)">${iniciais}</div><div><div class="perf-name">${v.name}</div><div class="perf-count">${v.pedidos} vendas fechadas</div></div></div>
        <div class="perf-stats">
          <div class="ps-block" style="background:var(--teal-pale);color:#006B4C"><div class="ps-val">${v.noPrazo}</div><div class="ps-lbl">No Prazo</div></div>
          <div class="ps-block" style="background:var(--red-pale);color:#991B1B"><div class="ps-val">${v.atraso}</div><div class="ps-lbl">Atraso</div></div>
          <div class="ps-block" style="background:var(--blue-pale);color:var(--blue)"><div class="ps-val">${sla}%</div><div class="ps-lbl">SLA</div></div>
        </div>
        <div style="background:var(--bg); border-radius:8px; padding:8px 10px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;"><span style="font-size:11px;color:var(--muted)">TKT Médio:</span><strong style="font-size:13px;color:var(--navy)">${formatMoney(ticketMedio)}</strong></div>
        <div class="pbar-wrap"><div class="pbar-top"><span class="pbar-lbl">Performance vs Top Player</span><strong>${pctVolumeTotal}%</strong></div><div class="pbar-bg"><div class="pbar-fill" style="width:${pctVolumeTotal}%; background:var(--blue)"></div></div></div>
        <div style="margin-top:14px; font-size:12px; display:flex; flex-direction:column; gap:4px; border-top:1px solid var(--border); padding-top:10px;">
          <div style="display:flex; justify-content:space-between;"><span style="color:var(--muted)">Faturamento:</span><strong style="color:var(--teal)">${formatMoney(v.faturamento)}</strong></div>
          <div style="display:flex; justify-content:space-between;"><span style="color:var(--muted)">Total Frete:</span><strong style="color:var(--text)">${formatMoney(v.frete)}</strong></div>
          <div style="display:flex; justify-content:space-between;"><span style="color:var(--muted)">KPI % Frete:</span><strong style="color:var(--blue)">${kpiFrete}%</strong></div>
        </div>
      </div>`;
  }).join('');
}





async function carregarDePara() {
  const selectEl = document.getElementById('dp-usuario-id');
  const tbodyEl  = document.getElementById('tabela-de-para');

  // Carrega usuários no select
  if (selectEl) {
    selectEl.innerHTML = '<option value="">Carregando usuários...</option>';
    try {
      const res = await apiFetch('/api/usuarios/');
      if (!res) return;
      const users = await res.json();
      selectEl.innerHTML = '<option value="">Selecione um usuário</option>' +
        users.filter(u => u.ativo).map(u =>
          `<option value="${u.id}">${escapeHtml(u.email)} | ${escapeHtml(u.nome)}</option>`
        ).join('');
    } catch (e) {
      selectEl.innerHTML = '<option value="">Erro ao carregar usuários</option>';
    }
  }

  // Carrega vínculos existentes
  if (tbodyEl) {
    tbodyEl.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--muted)">Carregando vínculos...</td></tr>';
    try {
      const res = await apiFetch('/api/vendedores/de-para');
      if (!res) return;
      const lista = await res.json();
      if (lista.length === 0) {
        tbodyEl.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--muted)">Nenhum vínculo cadastrado.</td></tr>';
      } else {
        tbodyEl.innerHTML = lista.map(v => `
          <tr>
            <td><strong style="color:var(--text)">${escapeHtml(v.nome_planilha)}</strong></td>
            <td>
              <span style="display:flex;flex-direction:column;gap:2px">
                <strong style="font-size:13px;color:var(--text)">${escapeHtml(v.usuario_nome)}</strong>
                <span style="font-size:11.5px;color:var(--muted)">${escapeHtml(v.usuario_email || '')}</span>
              </span>
            </td>
            <td><button class="delete-btn" onclick="deletarDePara(${v.id})">🗑</button></td>
          </tr>
        `).join('');
      }
    } catch (e) {
      tbodyEl.innerHTML = '<tr><td colspan="3" style="color:red">Erro ao carregar vínculos.</td></tr>';
    }
  }
}

async function salvarDePara() {
    const inputNome = document.getElementById('dp-nome-planilha');
    const selectUsuario = document.getElementById('dp-usuario-id');

    const nome_planilha = inputNome ? inputNome.value.trim() : '';
    const usuario_id = selectUsuario ? parseInt(selectUsuario.value) : '';

    if (!nome_planilha || !usuario_id) {
        alert('Por favor, preencha o nome na planilha e selecione um usuário do sistema.');
        return;
    }

    try {
        const response = await apiFetch('/api/vendedores/de-para', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nome_planilha, usuario_id })
        });

        if (response.ok) {
            alert('Vínculo salvo com sucesso!');
            if (inputNome) inputNome.value = '';
            if (selectUsuario) selectUsuario.value = '';
            carregarDePara();
        } else {
            alert('Erro ao salvar o vínculo.');
        }
    } catch (e) {
        console.error('Erro ao salvar vínculo De-Para:', e);
        alert('Erro de conexão ao salvar vínculo.');
    }
}

async function deletarDePara(id) {
    if (!confirm('Deseja realmente remover este vínculo?')) return;

    try {
        const response = await apiFetch(`/api/vendedores/de-para/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            carregarDePara();
        } else {
            alert('Erro ao remover o vínculo.');
        }
    } catch (e) {
        console.error('Erro ao deletar vínculo De-Para:', e);
    }
}