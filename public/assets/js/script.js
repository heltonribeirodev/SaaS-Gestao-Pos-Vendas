// ═══════════════════════════════════════════════
// ESTADO GLOBAL DO APLICATIVO E API CLIENT
// ═══════════════════════════════════════════════
let dataSET = [];
let filteredData = [];
let currentPage = 1;
const rowsPerPage = 15;
let currentSort = { col: 'id', asc: true };
let urgencyFilter = null;
let currentUser = null;

const STATUS_OPTIONS = ['EM TRÂNSITO', 'EM ROTA DE ENTREGA', 'ENTREGUE', 'RETIDO FISCALIZAÇÃO', 'FOB', 'CANCELADO', 'DEVOLUÇÃO'];

// Variáveis Globais dos Gráficos e Mapa
let chartStatusInstance = null;
let chartVendInstance = null;
let chartTranspInstance = null;
let mapInstance = null;
let geojsonLayer = null;
const BRASIL_GEOJSON_URL = 'https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/brazil-states.geojson';
let brasilGeoData = null;

const colors = { blue: '#1B6FD5', teal: '#00A878', amber: '#F59E0B', orange: '#F97316', red: '#EF4444', muted: '#6B7FA3', border: '#DDE6F5', navy: '#002B5C' };

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
  return !s.startsWith('ENTREGUE') && !s.startsWith('CANCEL') && s !== 'FOB';
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
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function isoToBr(str) {
  if (!str || typeof str !== 'string' || !str.includes('-') || str.startsWith('0001')) return '';
  // Extrai apenas a parte da data YYYY-MM-DD ignorando hora/fuso
  const dateOnly = str.split('T')[0].split(' ')[0];
  const [y, m, d] = dateOnly.split('-');
  return (y && m && d) ? `${d}/${m}/${y}` : '';
}

function excelToIsoDate(value) {
  if (value === undefined || value === null || value === '') return '';
  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getFullYear(), m = String(value.getMonth() + 1).padStart(2, '0'), d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'number' && typeof XLSX !== 'undefined' && XLSX.SSF) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
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

const formatMoney = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

function getBadgeClass(status) {
  switch (String(status).toUpperCase()) {
    case 'EM TRÂNSITO': return 'bT';
    case 'EM ROTA DE ENTREGA': return 'bR';
    case 'ENTREGUE': return 'bE';
    case 'RETIDO FISCALIZAÇÃO': return 'bF';
    case 'FOB': return 'bFob';
    case 'CANCELADO': return 'bC';
    case 'DEVOLUÇÃO': return 'bDev';
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
  } catch { }

  applyLoggedUser();
  await loadPedidosFromDB();
  // Marca o primeiro sync e liga o polling automático
  _lastSyncAt = new Date();
  const _initHhmm = _lastSyncAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  _setSyncBadge('ok', `Atualizado ${_initHhmm}`);
  startAutoRefresh();

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
    dataSET = rawData.map((dbItem, index) => {

      // ══════════════════════════════════════════════════════════════
      // CORREÇÃO AQUI: Garantindo que o status seja EXCLUSIVAMENTE uma string
      // ══════════════════════════════════════════════════════════════
      let statusTratado = 'EM TRÂNSITO';
      if (dbItem.status) {
        if (typeof dbItem.status === 'object') {
          // Se o backend mandou um objeto, tenta extrair a string da propriedade correta
          // (Pode ser .valor, .nome, ou .status dependendo de como sua API serializa)
          statusTratado = dbItem.status.valor || dbItem.status.status || dbItem.status.nome || 'EM TRÂNSITO';
        } else {
          // Se já for string, pega direto
          statusTratado = dbItem.status;
        }
      }
      // Força para String e deixa em maiúsculo para padronizar
      statusTratado = String(statusTratado).toUpperCase().trim();

      return {
        _rowId: index,
        _dbId: dbItem.id,
        id: dbItem.nf || `S/N-${dbItem.id}`,
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
        status: statusTratado, // <--- Aplicado o status 100% string aqui
        obs: dbItem.obs || '',
        obs_rastreio: dbItem.obs_rastreio || ''
      };
    });

    const _sel = (id) => document.getElementById(id)?.value || '';
    const _savedVend = _sel('f-vend');
    const _savedTransp = _sel('f-transp');
    const _savedUf = _sel('f-uf');

    buildFilterDropdowns();

    const _set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    _set('f-vend', _savedVend);
    _set('f-transp', _savedTransp);
    _set('f-uf', _savedUf);

    applyFilters(true);
  } catch (error) {
    showToast('Falha ao carregar dados do servidor.');
  }
}

// ── AUTO-REFRESH (polling a cada 30s) ─────────────────────────────────────────
const AUTO_REFRESH_INTERVAL_MS = 5_000; // 5 segundos
let _autoRefreshTimer = null;
let _lastSyncAt = null;

/** Retorna true se algum modal/overlay estiver aberto — polling deve esperar */
function _isAnyModalOpen() {
  // 1. Verifica se algum modal/overlay está aberto
  const overlayIds = ['overlay', 'manual-overlay', 'user-overlay', 'perfil-overlay'];
  const modalAberto = overlayIds.some(id => {
    const el = document.getElementById(id);
    if (!el) return false;
    const cls = el.classList;
    return cls.contains('open') || el.style.display === 'flex';
  });

  if (modalAberto) return true;

  // 2. Impede a sincronização se o usuário estiver digitando/interagindo com algum input na tabela
  const activeEl = document.activeElement;
  if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'SELECT' || activeEl.tagName === 'TEXTAREA')) {
    return true;
  }

  return false;
}

/** Atualiza o badge visual de sincronização */
function _setSyncBadge(state, label) {
  const badge = document.getElementById('sync-badge');
  const lbl = document.getElementById('sync-label');
  if (!badge || !lbl) return;
  badge.className = `sync-badge sync-${state}`;
  lbl.textContent = label;
}

/** Executa o refresh silencioso (sem travar a UI) */
async function _autoRefreshTick() {
  // Pausa se tab está oculta ou modal aberto
  if (document.hidden) {
    _setSyncBadge('paused', 'Em pausa');
    return;
  }
  if (_isAnyModalOpen()) {
    _setSyncBadge('paused', 'Aguardando...');
    return;
  }

  _setSyncBadge('busy', 'Sincronizando...');
  try {
    await loadPedidosFromDB();
    _lastSyncAt = new Date();
    const hhmm = _lastSyncAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    _setSyncBadge('ok', `Atualizado ${hhmm}`);
  } catch {
    _setSyncBadge('idle', 'Falha na sync');
  }
}

/** Inicia o polling automático e registra eventos de visibilidade */
function startAutoRefresh() {
  // Ao voltar à aba, dispara imediatamente se já passou muito tempo
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      const elapsed = _lastSyncAt ? Date.now() - _lastSyncAt.getTime() : Infinity;
      if (elapsed > AUTO_REFRESH_INTERVAL_MS) _autoRefreshTick();
      else _setSyncBadge('ok', _lastSyncAt
        ? `Atualizado ${_lastSyncAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
        : '–');
    }
  });

  // Inicia o intervalo principal
  _autoRefreshTimer = setInterval(_autoRefreshTick, AUTO_REFRESH_INTERVAL_MS);
}
// ── FIM AUTO-REFRESH ───────────────────────────────────────────────────────────

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

  const titles = { dashboard: 'Dashboard', pedidos: 'Pedidos', transportadoras: 'Transportadoras', vendedores: 'Vendedores', administracao: 'Administração', logs: 'Auditoria' };
  document.getElementById('top-title').innerText = titles[tabId] || 'ForteCare';

  if (tabId === 'transportadoras') renderTransportadoras();
  if (tabId === 'vendedores') renderVendedores();
  if (tabId === 'administracao') {
    loadAndRenderUsersPanel();
    carregarDePara();
  }
  if (tabId === 'logs') loadLogs(true);
}

// ═══════════════════════════════════════════════
// ENGINE DE FILTROS E DATAS (MANTIDO IGUAL)
// ═══════════════════════════════════════════════
function applyFilters(keepPage = false) {
  const fStatus = (document.getElementById('f-status')?.value || '').toUpperCase();
  const fVend = document.getElementById('f-vend')?.value || '';
  const fTransp = document.getElementById('f-transp')?.value || '';
  const fUf = document.getElementById('f-uf')?.value || '';
  const fQuery = (document.getElementById('f-q')?.value || '').toLowerCase();
  const fFrom = document.getElementById('f-dfrom')?.value || '';
  const fTo = document.getElementById('f-dto')?.value || '';

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
      if (urgencyFilter === 'rota') {
        if (item.status.toUpperCase() !== 'EM ROTA DE ENTREGA') return false;
      } else if (urgencyFilter === 'retido') {
        if (item.status.toUpperCase() !== 'RETIDO FISCALIZAÇÃO') return false;
      } else if (urgencyFilter === 'fob') {
        if (item.status.toUpperCase() !== 'FOB') return false;
      } else if (urgencyFilter === 'cancelado') {
        if (item.status.toUpperCase() !== 'CANCELADO') return false;
      } else if (urgencyFilter === 'devolucao') {
        if (item.status.toUpperCase() !== 'DEVOLUÇÃO') return false;
      } else {
        const prev = parseBrDate(item.previsao);
        if (!prev) return false;
        const hoje = todayMidnight();

        if (urgencyFilter === 'hoje') {
          if (item.entrega || prev.getTime() !== hoje.getTime()) return false;
        }
        else if (urgencyFilter === 'atraso') {
          if (item.entrega && item.entrega.trim() !== '' || prev.getTime() >= hoje.getTime()) return false;
        }
      }
    }
    return true;
  });

  // Mantém a página atual se for chamado pelo auto-refresh (keepPage = true)
  if (!keepPage) {
    currentPage = 1;
  }

  executeDataRefresh();
}

function goToUrgent(type) {
  showTab('pedidos', document.querySelector('.sb-nav li:nth-child(2)'));
  clearFilters();
  urgencyFilter = type;
  const tag = document.getElementById('urgency-tag');
  if (tag) {
    tag.style.display = 'inline-flex';
    let txt = 'A entregar hoje';
    if (type === 'atraso') txt = 'Em atraso';
    if (type === 'rota') txt = 'Em rota de entrega';
    if (type === 'retido') txt = 'Retido fiscalização';
    if (type === 'fob') txt = 'FOB';
    if (type === 'cancelado') txt = 'Cancelados';
    if (type === 'devolucao') txt = 'Devoluções';
    tag.querySelector('.ptag-txt').innerText = txt;
  }
  applyFilters();
}

function clearUrgencyFilter() {
  urgencyFilter = null;
  document.getElementById('urgency-tag').style.display = 'none';
  applyFilters();
}

function clearFilters() {
  // Lista de todos os IDs de inputs que precisam ser limpos
  const filterIds = ['f-status', 'f-vend', 'f-transp', 'f-uf', 'f-q', 'g-search'];

  // Percorre a lista e só limpa o valor se o elemento existir na tela
  filterIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.value = '';
    }
  });

  urgencyFilter = null;

  // Verifica se a tag de urgência existe antes de ocultá-la
  const urgencyTag = document.getElementById('urgency-tag');
  if (urgencyTag) {
    urgencyTag.style.display = 'none';
  }

  // Chama a limpeza de datas (assumindo que essa função também esteja segura)
  if (typeof clearDateFilter === 'function') {
    clearDateFilter();
  }
}

function setPreset(preset, el) {
  document.querySelectorAll('.qchip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');

  const hoje = new Date();
  let de = new Date(), ate = new Date();

  switch (preset) {
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
  const data = getDashboardData();       // dados do mês atual (KPI cards)
  const allData = dataSET;              // todos os dados (alert cards de status operacional)
  const hoje = todayMidnight();
  const total = data.length;
  const entregues = data.filter(p => p.status.toUpperCase() === 'ENTREGUE').length;
  const emTransito = data.filter(p => p.status.toUpperCase() === 'EM TRÂNSITO').length;

  // Alert cards: contagem global (sem filtro de mês) para refletir situação operacional real
  const emRota = allData.filter(p => p.status.toUpperCase() === 'EM ROTA DE ENTREGA').length;
  const retido = allData.filter(p => p.status.toUpperCase() === 'RETIDO FISCALIZAÇÃO').length;
  const fob = allData.filter(p => p.status.toUpperCase() === 'FOB').length;
  const cancelados = allData.filter(p => p.status.toUpperCase() === 'CANCELADO').length;
  const devolucoes = allData.filter(p => p.status.toUpperCase() === 'DEVOLUÇÃO').length;

  const elRota = document.getElementById('qtd-rota');
  if (elRota) elRota.innerText = emRota;
  const elRetido = document.getElementById('qtd-retido');
  if (elRetido) elRetido.innerText = retido;
  const elFob = document.getElementById('qtd-fob');
  if (elFob) elFob.innerText = fob;
  const elCancelados = document.getElementById('qtd-cancelados');
  if (elCancelados) elCancelados.innerText = cancelados;
  const elDevolucoes = document.getElementById('qtd-devolucoes');
  if (elDevolucoes) elDevolucoes.innerText = devolucoes;

  document.getElementById('kpi-total').innerText = total;
  document.getElementById('kpi-ent').innerText = entregues;
  document.getElementById('kpi-ent-pct').innerText = total > 0 ? Math.round((entregues / total) * 100) + '%' : '0%';
  document.getElementById('kpi-trans').innerText = emTransito;

  const mesNomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
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

  // Loop 1 — alert cards "Hoje" e "Em Atraso": usa allData (todos os meses) para não perder NFs abertas de meses anteriores
  // Ignora CANCELADO e FOB pois não estão mais em trânsito ativo
  allData.forEach(item => {
    const s = (item.status || '').toUpperCase();
    if (s === 'CANCELADO' || s === 'FOB' || s === 'DEVOLUÇÃO') return;
    const prev = parseBrDate(item.previsao);
    const temEntrega = item.entrega && item.entrega.trim() !== '' && item.entrega !== 'dd/mm/aaaa';
    if (temEntrega || !prev) return; // só conta pendentes sem entrega confirmada
    if (prev.getTime() === hoje.getTime()) {
      entregarHoje++;
    } else if (prev.getTime() < hoje.getTime()) {
      emAtraso++;
    }
  });

  // Loop 2 — SLA e "Entregas Atrasadas" (KPI cards do mês): usa data filtrada pelo mês atual
  data.forEach(item => {
    const prev = parseBrDate(item.previsao);
    const temEntrega = item.entrega && item.entrega.trim() !== '' && item.entrega !== 'dd/mm/aaaa';
    if (!temEntrega) return; // só conta entregues (com data de entrega)
    const entregaDate = parseBrDate(item.entrega);
    if (entregaDate && prev) {
      if (entregaDate.getTime() > prev.getTime()) {
        entreguesAtrasados++;
      } else {
        entreguesNoPrazo++;
      }
    } else {
      entreguesNoPrazo++;
    }
  });

  document.getElementById('kpi-hoje').innerText = entregarHoje;
  document.getElementById('kpi-atraso').innerText = emAtraso;
  document.getElementById('card-atraso').classList.toggle('is-alert', emAtraso > 0);
  document.getElementById('card-hoje').classList.toggle('is-alert', entregarHoje > 0);
  document.getElementById('kpi-atrasos-total').innerText = entreguesAtrasados;

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

  const monthKey = getCurrentMonthKey();
  const dataEntreguesMes = dataSET.filter(i =>
    String(i.status).toUpperCase() === 'ENTREGUE' &&
    brToIso(i.entrega || '').slice(0, 7) === monthKey
  );
  const totalValorNFmes = dataEntreguesMes.reduce((acc, i) => acc + (i.valorNF || 0), 0);
  const totalFretemes = dataEntreguesMes.reduce((acc, i) => acc + (i.valorC || 0), 0);
  const freteMedio = totalValorNFmes > 0 ? (totalFretemes / totalValorNFmes) * 100 : null;
  document.getElementById('kpi-frete').innerText = freteMedio === null ? '–' : freteMedio.toFixed(2) + '%';

  const rBody = document.getElementById('r-body');
  if (data.length === 0) {
    rBody.innerHTML = `<tr><td colspan="8" class="empty">Nenhum registro com emissão no mês atual.</td></tr>`;
  } else {
    rBody.innerHTML = [...data].sort((a, b) => b.emissao.localeCompare(a.emissao)).slice(0, 10).map(item => `
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
  // Destruir instâncias antigas de Chart.js
  if (chartStatusInstance) chartStatusInstance.destroy();
  if (chartVendInstance) chartVendInstance.destroy();
  if (chartTranspInstance) chartTranspInstance.destroy();

  // Gráfico Doughnut (Status)
  const statusCounts = { 'ENTREGUE': 0, 'EM TRÂNSITO': 0, 'EM ROTA DE ENTREGA': 0, 'RETIDO FISCALIZAÇÃO': 0, 'FOB': 0, 'CANCELADO': 0, 'DEVOLUÇÃO': 0 };
  data.forEach(i => {
    let s = i.status.toUpperCase();
    if (statusCounts[s] !== undefined) statusCounts[s]++;
  });
  // Remove status sem ocorrências para não poluir o gráfico
  Object.keys(statusCounts).forEach(k => { if (statusCounts[k] === 0) delete statusCounts[k]; });

  const statusColorMap = {
    'ENTREGUE': colors.teal,
    'EM TRÂNSITO': colors.amber,
    'EM ROTA DE ENTREGA': colors.orange,
    'RETIDO FISCALIZAÇÃO': colors.red,
    'FOB': '#A855F7',
    'CANCELADO': '#9CA3AF',
    'DEVOLUÇÃO': '#BE123C'
  };
  const ctxStatus = document.getElementById('c-status');
  if (ctxStatus) {
    const chartColors = Object.keys(statusCounts).map(k => statusColorMap[k] || colors.muted);
    chartStatusInstance = new Chart(ctxStatus, {
      type: 'doughnut',
      data: { labels: Object.keys(statusCounts), datasets: [{ data: Object.values(statusCounts), backgroundColor: chartColors, borderWidth: 2, hoverOffset: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
    const total = data.length;
    document.getElementById('status-legend').innerHTML = Object.keys(statusCounts).map((key) => {
      const color = statusColorMap[key] || colors.muted;
      const count = statusCounts[key];
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      return `<div class="sl-row"><div class="sl-left"><div class="sl-dot" style="background:${color}"></div>${key}</div><div class="sl-count">${count} <span style="color:var(--muted);font-weight:400">(${pct}%)</span></div></div>`;
    }).join('');
  }

  // Gráfico Bar (Faturamento Vendedor)
  const vendData = {};
  data.forEach(i => { vendData[i.vendedor] = (vendData[i.vendedor] || 0) + (i.valorNF || 0); });

  const ctxVend = document.getElementById('c-vend');
  if (ctxVend) {
    chartVendInstance = new Chart(ctxVend, {
      type: 'bar',
      data: {
        labels: Object.keys(vendData),
        datasets: [{
          label: 'Faturamento',
          data: Object.values(vendData),
          backgroundColor: colors.blue,
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (context) {
                let label = context.dataset.label || '';
                if (label) {
                  label += ': ';
                }
                if (context.parsed.x !== null) {
                  label += new Intl.NumberFormat('pt-BR', {
                    style: 'currency',
                    currency: 'BRL'
                  }).format(context.parsed.x);
                }
                return label;
              }
            }
          }
        },
        scales: {
          y: {
            grid: { display: false },
            ticks: {
              font: { size: 10 },
              crossAlign: 'far', // Força o alinhamento do texto à extrema esquerda
              callback: function (value) {
                let label = this.getLabelForValue(value) || '';
                const limiteCaracteres = 15; // Ajuste conforme o espaço em tela

                // Aplica o corte e adiciona reticências se exceder o limite
                if (label.length > limiteCaracteres) {
                  return label.substring(0, limiteCaracteres) + '...';
                }
                return label;
              }
            }
          },
          x: {
            ticks: {
              font: { size: 10 },
              callback: function (value, index, values) {
                return new Intl.NumberFormat('pt-BR', {
                  style: 'currency',
                  currency: 'BRL'
                }).format(value);
              }
            }
          }
        }
      }
    });
  }

  const transpData = {};

  // 1. Agrupando os valores pela chave 'transportadora'
  data.forEach(i => {
    // O 'if' previne que transportadoras vazias ou indefinidas quebrem o gráfico
    if (i.transportadora) {
      const nomeTransp = i.transportadora.trim();
      transpData[nomeTransp] = (transpData[nomeTransp] || 0) + (i.valorC || 0);
    }
  });

  // 2. Buscando o novo elemento no DOM (Certifique-se de ter id="c-transp" no seu HTML)
  const ctxTransp = document.getElementById('c-transp');

  if (ctxTransp) {
    chartTranspInstance = new Chart(ctxTransp, {
      type: 'bar',
      data: {
        labels: Object.keys(transpData),
        datasets: [{
          label: 'Valor por Transportadora', // Ajuste a label conforme necessário
          data: Object.values(transpData),
          backgroundColor: colors.blue, // Requer que o objeto 'colors' esteja declarado no seu script
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: 'y', // Mantém o gráfico em barras horizontais
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (context) {
                let label = context.dataset.label || '';
                if (label) {
                  label += ': ';
                }
                if (context.parsed.x !== null) {
                  // Formatação monetária (BRL) para o tooltip
                  label += new Intl.NumberFormat('pt-BR', {
                    style: 'currency',
                    currency: 'BRL'
                  }).format(context.parsed.x);
                }
                return label;
              }
            }
          }
        },
        scales: {
          y: {
            grid: { display: false },
            ticks: {
              font: { size: 10 },
              crossAlign: 'far', // Força o alinhamento do texto à extrema esquerda
              callback: function (value) {
                let label = this.getLabelForValue(value) || '';
                const limiteCaracteres = 15; // Ajuste conforme o espaço em tela

                // Aplica o corte e adiciona reticências se exceder o limite
                if (label.length > limiteCaracteres) {
                  return label.substring(0, limiteCaracteres) + '...';
                }
                return label;
              }
            }
          },
          x: {
            ticks: {
              font: { size: 10 },
              callback: function (value, index, values) {
                return new Intl.NumberFormat('pt-BR', {
                  style: 'currency',
                  currency: 'BRL'
                }).format(value);
              }
            }
          }
        }
      }
    });
  }

  // Renderiza o mapa coroplético de UF
  renderMapUF(data);
}

// ═══════════════════════════════════════════════
// MAPA GEOGRÁFICO DE ENVIOS POR UF (LEAFLET)
// ═══════════════════════════════════════════════
async function renderMapUF(data) {
  // 1. Agrupar total de envios por UF
  const ufCounts = {};
  data.forEach(i => {
    if (i.uf) {
      const ufUpper = i.uf.trim().toUpperCase();
      ufCounts[ufUpper] = (ufCounts[ufUpper] || 0) + 1;
    }
  });

  const maxEnvios = Math.max(...Object.values(ufCounts), 1);

  // 2. Função de escala de cor
  function getColor(d) {
    if (!d) return '#E2E8F0'; // Estado sem envios
    const ratio = d / maxEnvios;
    return ratio > 0.75 ? '#002B5C' :
      ratio > 0.50 ? '#1B6FD5' :
        ratio > 0.25 ? '#60A5FA' :
          '#BFDBFE';
  }

  // 3. Inicializar o mapa Leaflet se não existir
  if (!mapInstance) {
    const mapContainer = document.getElementById('map-uf');
    if (!mapContainer) return;

    mapInstance = L.map('map-uf', {
      center: [-14.2350, -51.9253], // Centro do Brasil
      zoom: 2,
      zoomControl: false,
      attributionControl: false
    });

    // Camada de fundo minimalista
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
      maxZoom: 7,
      minZoom: 3
    }).addTo(mapInstance);
  }

  // 4. Carregar GeoJSON dos estados se ainda não foi carregado
  if (!brasilGeoData) {
    try {
      const resp = await fetch(BRASIL_GEOJSON_URL);
      brasilGeoData = await resp.json();
    } catch (e) {
      console.error('Erro ao carregar malha geográfica do Brasil', e);
      return;
    }
  }

  // 5. Remover camada anterior se existir (re-renderização via filtros)
  if (geojsonLayer) {
    mapInstance.removeLayer(geojsonLayer);
  }

  // 6. Desenhar estados com cores dinâmicas baseadas nos dados
  geojsonLayer = L.geoJson(brasilGeoData, {
    style: function (feature) {
      const siglaUF = feature.properties.sigla;
      const count = ufCounts[siglaUF] || 0;
      return {
        fillColor: getColor(count),
        weight: 1,
        opacity: 1,
        color: '#FFFFFF',
        fillOpacity: 0.85
      };
    },
    onEachFeature: function (feature, layer) {
      const siglaUF = feature.properties.sigla;
      const nomeUF = feature.properties.name;
      const count = ufCounts[siglaUF] || 0;

      layer.bindTooltip(
        `<strong>${nomeUF} (${siglaUF})</strong><br/>${count} envio(s)`,
        { permanent: false, direction: 'auto' }
      );
    }
  }).addTo(mapInstance);
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

  // Ordenação ajustada para o número da NF (id) do maior para o menor (decrescente)
  filteredData.sort((a, b) => {
    let valA = a[currentSort.col];
    let valB = b[currentSort.col];

    // Se a coluna de ordenação for o ID/NF, força a ordem decrescente (maior número primeiro)
    if (currentSort.col === 'id') {
      const numA = parseFloat(String(valA).replace(/\D/g, '')) || 0;
      const numB = parseFloat(String(valB).replace(/\D/g, '')) || 0;
      return currentSort.asc ? numA - numB : numB - numA;
    }

    if (typeof valA === 'string') return currentSort.asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    else return currentSort.asc ? valA - valB : valB - valA;
  });

  const idxStart = (currentPage - 1) * rowsPerPage;
  const paginatedItems = filteredData.slice(idxStart, idxStart + rowsPerPage);

  const isSolange = (v) => v.toUpperCase().trim() === 'SOLANGE DOMINGUES';
  const PODE_EDITAR = currentUser && ['Administrador', 'Gerente de Logística', 'Operador'].includes(currentUser.tipo);

  pBody.innerHTML = paginatedItems.map(item => `
    <tr class="${isSolange(item.vendedor) ? 'row-licitacao' : ''}">
      <td class="td-mono">${item.id}</td>
      <td class="${isSolange(item.vendedor) ? 'td-licitacao-vend' : ''}" style="font-weight:500">${item.vendedor}</td>
      <td class="td-dest" title="${item.destinatario}">${item.destinatario}</td>
      <td><span style="font-weight:700; color:var(--navy)">${item.uf}</span></td>
      <td class="td-ct" title="${item.municipio}">${item.municipio}</td>
      <td>${item.transportadora}</td>
      <td>${formatDateToBr(item.emissao)}</td>
      <td class="td-money">${formatMoney(item.valorNF)}</td>
      <td>${item.previsao}</td>
      <td>
        ${PODE_EDITAR
          ? `<input type="date" class="entrega-edit-input" value="${brToIso(item.entrega)}"
                    onchange="autoEntregue(${item._rowId}, this.value)">`
          : `<span class="td-readonly">${item.entrega || '—'}</span>`}
      </td>
      <td>
        ${PODE_EDITAR
          ? `<input type="text" class="contato-edit-input" value="${escapeHtml(item.contato)}"
                    placeholder="Sem contato" onchange="updatePedidoAPI(${item._rowId}, { contato: this.value })">`
          : `<span class="td-readonly">${escapeHtml(item.contato) || '—'}</span>`}
      </td>
      <td>
        ${PODE_EDITAR
          ? `<div class="frete-edit-wrap">
               <input type="number" step="0.01" min="0" class="frete-edit-input"
                      value="${item.valorC ?? 0}"
                      onchange="updatePedidoAPI(${item._rowId}, { valor_frete: this.value })">
               <span class="frete-pct" title="% de frete calculado">${calcPct(item.valorNF, item.valorC).toFixed(1)}%</span>
             </div>`
          : `<span class="td-readonly">${formatMoney(item.valorC ?? 0)} <span class="frete-pct">${calcPct(item.valorNF, item.valorC).toFixed(1)}%</span></span>`}
      </td>
      <td>
        ${PODE_EDITAR
          ? `<select class="status-edit ${getBadgeClass(item.status)}" onchange="updatePedidoAPI(${item._rowId}, { status: this.value })">
               ${STATUS_OPTIONS.map(s => `<option value="${s}" ${item.status.toUpperCase() === s ? 'selected' : ''}>${s}</option>`).join('')}
             </select>`
          : `<span class="badge ${getBadgeClass(item.status)}">${item.status}</span>`}
      </td>
      <td>
        ${PODE_EDITAR
          ? `<div class="obs-edit-wrap">
               <input type="text" class="obs-edit-input" id="obs-${item._rowId}"
                      value="${escapeHtml(item.obs)}" placeholder="Sem observação"
                      onchange="updatePedidoAPI(${item._rowId}, { obs: this.value })">
               ${item.obs ? `<span class="obs-edit-clear" title="Remover observação" onclick="clearObs(${item._rowId})">✕</span>` : ''}
             </div>`
          : `<span class="td-readonly">${escapeHtml(item.obs) || '—'}</span>`}
      </td>
      <td>
        ${PODE_EDITAR
          ? `<div class="obs-edit-wrap">
               <input type="text" class="obs-edit-input" id="obs-rastreio-${item._rowId}"
                      value="${escapeHtml(item.obs_rastreio)}" placeholder="Sem obs rastreio"
                      onchange="updatePedidoAPI(${item._rowId}, { obs_rastreio: this.value })">
               ${item.obs_rastreio ? `<span class="obs-edit-clear" title="Remover rastreio" onclick="clearObsRastreio(${item._rowId})">✕</span>` : ''}
             </div>`
          : `<span class="td-readonly">${escapeHtml(item.obs_rastreio) || '—'}</span>`}
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
      if (updatePayload.obs_rastreio !== undefined) item.obs_rastreio = updatePayload.obs_rastreio;
      if (updatePayload.contato !== undefined) item.contato = updatePayload.contato;

      // CORREÇÃO: Se a data recebida for null, deixa o campo da UI em branco
      if (updatePayload.entrega !== undefined) {
        item.entrega = (updatePayload.entrega && typeof updatePayload.entrega === 'string')
          ? isoToBr(updatePayload.entrega)
          : '';
      }

      if (updatePayload.valor_frete !== undefined) {
        item.valorC = parseFloat(updatePayload.valor_frete) || 0;
        item.pct = calcPct(item.valorNF, item.valorC);
      }

      executeDataRefresh();
      showToast('Alteração salva no banco de dados.');
    } else {
      const data = await res.json();

      // CORREÇÃO: Tratamento inteligente para evitar o [object Object] na notificação
      let errMsg = 'Erro ao atualizar.';
      if (data.detail) {
        if (typeof data.detail === 'string') {
          errMsg = data.detail;
        } else if (Array.isArray(data.detail)) {
          // Se for erro do FastAPI/Pydantic, pega a mensagem legível
          errMsg = data.detail.map(e => e.msg || 'Erro de validação').join(', ');
        } else {
          errMsg = JSON.stringify(data.detail);
        }
      }
      showToast(errMsg);
    }
  } catch (err) {
    showToast('Falha na comunicação com o servidor.');
  }
}

function autoEntregue(rowId, dateValue) {
  const item = findByRowId(rowId);
  if (!item) return;

  // 🚨 O SEGREDO AQUI: Envia a 'data zero' que o backend entende em vez de null
  const payload = { entrega: dateValue ? dateValue : '0001-01-01' };

  const setStatusSelect = (status, badgeClass) => {
    document.querySelectorAll('select.status-edit').forEach(sel => {
      if (sel.getAttribute('onchange')?.includes(`updatePedidoAPI(${rowId},`)) {
        sel.value = status;
        sel.className = `status-edit ${badgeClass}`;
      }
    });
  };

  const currentStatus = item.status.toUpperCase();
  if (dateValue) {
    // Não altera automaticamente se estiver cancelado, devolvido ou já entregue
    if (currentStatus !== 'ENTREGUE' && currentStatus !== 'CANCELADO' && currentStatus !== 'DEVOLUÇÃO') {
      payload.status = 'ENTREGUE';
      setStatusSelect('ENTREGUE', 'bE');
    }
  } else {
    // Data apagada -> Volta para EM TRÂNSITO (só se estava ENTREGUE)
    if (currentStatus === 'ENTREGUE') {
      payload.status = 'EM TRÂNSITO';
      setStatusSelect('EM TRÂNSITO', 'bT');
    }
  }

  // Atualiza o estado local IMEDIATAMENTE (isoToBr já sabe que 0001 vira vazio)
  item.entrega = dateValue ? isoToBr(dateValue) : '';

  updatePedidoAPI(rowId, payload);
}

function clearObs(rowId) {
  const input = document.getElementById('obs-' + rowId);
  if (input) input.value = '';
  updatePedidoAPI(rowId, { obs: '' });
}

function clearObsRastreio(rowId) {
  const input = document.getElementById('obs-rastreio-' + rowId);
  if (input) input.value = '';
  updatePedidoAPI(rowId, { obs_rastreio: '' });
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
  if (!str || !str.includes('-')) return str;
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
    status: document.getElementById('m-status').value, obs: document.getElementById('m-obs').value.trim(), obs_rastreio: document.getElementById('m-obs-rastreio').value.trim()
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

  reader.onload = async function (evt) {
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
          transportadora: String(r['Transportadora'] || r['TRANSPORTADORA'] || '').toUpperCase().trim(),
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
  if (filteredData.length === 0) { showToast("Sem dados ativos para exportar."); return; }
  const headers = ['#NF', 'Vendedor', 'Destinatario', 'UF', 'Municipio', 'Transportadora', 'Emissao', 'ValorNF', 'ValorFrete', 'PercFrete', 'Previsao', 'DataEntregue', 'Contato', 'Status', 'Obs', 'ObsRastreio'];
  const rows = filteredData.map(i => [i.id, i.vendedor, i.destinatario, i.uf, i.municipio, i.transportadora, i.emissao, i.valorNF, i.valorC, calcPct(i.valorNF, i.valorC), i.previsao, i.entrega, i.contato, i.status, i.obs, i.obs_rastreio].map(csvEscape).join(';'));
  const csvContent = "\uFEFF" + headers.join(';') + "\n" + rows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.setAttribute("href", url); link.setAttribute("download", `fortecare_export_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url);
  showToast(`${filteredData.length} registro(s) exportado(s).`);
}

// ═══════════════════════════════════════════════════════════
// LOGS DE AUDITORIA
// ═══════════════════════════════════════════════════════════
let logsOffset = 0;
const LOGS_LIMIT = 80;
let logsTotal = 0;
let _logDebounce = null;

function debounceLoadLogs() {
  clearTimeout(_logDebounce);
  _logDebounce = setTimeout(() => loadLogs(true), 400);
}

function clearLogsFilters() {
  document.getElementById('log-f-acao').value = '';
  document.getElementById('log-f-busca').value = '';
  document.getElementById('log-f-de').value = '';
  document.getElementById('log-f-ate').value = '';
  loadLogs(true);
}

async function loadLogs(reset = false) {
  if (reset) logsOffset = 0;
  const acao  = document.getElementById('log-f-acao')?.value || '';
  const busca = document.getElementById('log-f-busca')?.value || '';
  const de    = document.getElementById('log-f-de')?.value || '';
  const ate   = document.getElementById('log-f-ate')?.value || '';

  const params = new URLSearchParams({ limit: LOGS_LIMIT, offset: logsOffset });
  if (acao)  params.set('acao', acao);
  if (busca) params.set('busca', busca);
  if (de)    params.set('de', de);
  if (ate)   params.set('ate', ate);

  const body = document.getElementById('logs-body');
  if (!body) return;
  body.innerHTML = `<tr><td colspan="7" class="td-empty"><i class="fa-solid fa-spinner fa-spin" style="margin-right:6px"></i>Carregando...</td></tr>`;

  try {
    const res = await apiFetch(`/api/logs?${params}`);
    if (!res.ok) throw new Error('Erro na requisição');
    const data = await res.json();
    
    logsTotal = data.total || 0;
    renderLogsTable(data.logs || []);
    renderLogsPagination();

    const summary = document.getElementById('logs-summary');
    const txt = document.getElementById('logs-total-txt');
    if (summary && txt) {
      summary.style.display = logsTotal > 0 ? '' : 'none';
      txt.textContent = `${logsTotal.toLocaleString('pt-BR')} registro${logsTotal !== 1 ? 's' : ''} encontrado${logsTotal !== 1 ? 's' : ''}`;
    }
  } catch (e) {
    body.innerHTML = `<tr><td colspan="7" class="td-empty" style="color:var(--danger)">Erro ao carregar logs.</td></tr>`;
  }
}

function renderLogsTable(logs) {
  const body = document.getElementById('logs-body');
  if (!body) return;
  if (!logs.length) {
    body.innerHTML = `<tr><td colspan="7" class="td-empty">Nenhum log encontrado.</td></tr>`;
    return;
  }
  body.innerHTML = logs.map(log => {
    const dt = log.criado_em ? new Date(log.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' }) : '—';
    const badgeClass = getLogBadgeClass(log.acao);
    const badgeLabel = getLogLabel(log.acao);
    const detalhe = formatLogDetalhe(log.detalhe);
    return `<tr>
      <td class="td-mono" style="font-size:12px; white-space:nowrap">${dt}</td>
      <td style="font-weight:500">${escapeHtml(log.usuario_nome || '—')}</td>
      <td><span class="log-badge ${badgeClass}">${badgeLabel}</span></td>
      <td style="color:var(--muted); font-size:12px">${log.entidade || '—'}</td>
      <td style="text-align:center; color:var(--muted); font-size:12px">${log.entidade_id || '—'}</td>
      <td class="log-detalhe-cell" title="${escapeHtml(log.detalhe || '')}">${detalhe}</td>
      <td class="td-mono" style="font-size:11px; color:var(--muted)">${log.ip || '—'}</td>
    </tr>`;
  }).join('');
}

function getLogBadgeClass(acao) {
  const map = {
    LOGIN_OK:         'log-b-ok',
    LOGIN_FALHA:      'log-b-danger',
    LOGOUT:           'log-b-muted',
    SENHA_ALTERADA:   'log-b-warn',
    SENHA_REDEFINIDA: 'log-b-warn',
    PEDIDO_CRIADO:    'log-b-teal',
    PEDIDO_EDITADO:   'log-b-blue',
    PEDIDO_EXCLUIDO:  'log-b-danger',
    PEDIDO_IMPORTADO: 'log-b-teal',
    USUARIO_CRIADO:   'log-b-teal',
    USUARIO_EDITADO:  'log-b-blue',
    USUARIO_EXCLUIDO: 'log-b-danger',
  };
  return map[acao] || 'log-b-muted';
}

function getLogLabel(acao) {
  const map = {
    LOGIN_OK:         '✓ Login',
    LOGIN_FALHA:      '✕ Login falhou',
    LOGOUT:           'Logout',
    SENHA_ALTERADA:   'Senha alterada',
    SENHA_REDEFINIDA: 'Senha redefinida',
    PEDIDO_CRIADO:    'Pedido criado',
    PEDIDO_EDITADO:   'Pedido editado',
    PEDIDO_EXCLUIDO:  'Pedido excluído',
    PEDIDO_IMPORTADO: 'Importação',
    USUARIO_CRIADO:   'Usuário criado',
    USUARIO_EDITADO:  'Usuário editado',
    USUARIO_EXCLUIDO: 'Usuário excluído',
  };
  return map[acao] || acao;
}

function formatLogDetalhe(raw) {
  if (!raw) return '—';
  try {
    const obj = JSON.parse(raw);
    // PEDIDO_EDITADO: {"nf":"123", "campos": {"status":{"de":"X","para":"Y"}}}
    if (obj.campos && typeof obj.campos === 'object') {
      const partes = Object.entries(obj.campos).map(([campo, diff]) =>
        `<span class="log-diff-campo">${campo}</span>: <span class="log-diff-de">${escapeHtml(String(diff.de || ''))}</span> → <span class="log-diff-para">${escapeHtml(String(diff.para || ''))}</span>`
      );
      const nfPart = obj.nf ? `<b>NF ${obj.nf}</b> · ` : '';
      return nfPart + (partes.length ? partes.join(' | ') : '(sem alterações)');
    }
    // PEDIDO_CRIADO / EXCLUIDO
    if (obj.nf) {
      return `NF <b>${escapeHtml(obj.nf)}</b>${obj.destinatario ? ' · ' + escapeHtml(obj.destinatario) : ''}`;
    }
    // PEDIDO_IMPORTADO
    if (obj.inseridos !== undefined) {
      return `${obj.inseridos} de ${obj.total_enviados} linhas importadas`;
    }
    // USUARIO_CRIADO / EDITADO / EXCLUIDO
    if (obj.nome || obj.email) {
      const campos = obj.campos ? ' · Campos: ' + Object.keys(obj.campos).join(', ') : '';
      const alvo = obj.alvo || obj.nome || '';
      return `${escapeHtml(alvo)}${obj.email ? ' (' + escapeHtml(obj.email) + ')' : ''}${obj.tipo ? ' · ' + escapeHtml(obj.tipo) : ''}${campos}`;
    }
    // Fallback: texto da chave mais relevante
    return escapeHtml(JSON.stringify(obj).substring(0, 120));
  } catch {
    return escapeHtml(String(raw).substring(0, 120));
  }
}

function renderLogsPagination() {
  const wrap = document.getElementById('logs-pagination');
  if (!wrap) return;
  const totalPages = Math.ceil(logsTotal / LOGS_LIMIT);
  const currentPage = Math.floor(logsOffset / LOGS_LIMIT) + 1;
  if (totalPages <= 1) { wrap.innerHTML = ''; return; }

  let html = `<div class="pag-info">${logsTotal.toLocaleString('pt-BR')} registros · Página ${currentPage} de ${totalPages}</div><div class="pag-btns">`;
  html += `<button class="pag-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="changeLogsPage(${currentPage - 1})">‹ Anterior</button>`;

  const delta = 2;
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= currentPage - delta && p <= currentPage + delta)) {
      html += `<button class="pag-btn ${p === currentPage ? 'active' : ''}" onclick="changeLogsPage(${p})">${p}</button>`;
    } else if (p === currentPage - delta - 1 || p === currentPage + delta + 1) {
      html += `<span class="pag-ellipsis">…</span>`;
    }
  }
  html += `<button class="pag-btn" ${currentPage === totalPages ? 'disabled' : ''} onclick="changeLogsPage(${currentPage + 1})">Próximo ›</button>`;
  html += '</div>';
  wrap.innerHTML = html;
}

function changeLogsPage(p) {
  logsOffset = (p - 1) * LOGS_LIMIT;
  loadLogs(false);
  document.getElementById('tab-logs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function exportLogsCSV() {
  try {
    const acaoEl  = document.getElementById('log-f-acao');
    const buscaEl = document.getElementById('log-f-busca');
    const deEl    = document.getElementById('log-f-de');
    const ateEl   = document.getElementById('log-f-ate');

    let acao  = acaoEl?.value?.trim() || '';
    let busca = buscaEl?.value?.trim() || '';
    let de    = deEl?.value?.trim() || '';
    let ate   = ateEl?.value?.trim() || '';

    // Limpa filtro padrao de "Todas as acoes"
    if (acao.toLowerCase().includes('toda')) acao = '';

    const params = new URLSearchParams({ limit: '5000', offset: '0' });
    if (acao)  params.set('acao', acao);
    if (busca) params.set('busca', busca);
    if (de)    params.set('de', de);
    if (ate)   params.set('ate', ate);

    // 1. Faz a chamada HTTP
    const res = await apiFetch(`/api/logs?${params.toString()}`);

    // 2. CONVERTE A RESPOSTA EM JSON (Ponto cego corrigido)
    const data = await res.json();

    const rows = data?.logs || (Array.isArray(data) ? data : []);

    if (!rows || rows.length === 0) {
      showToast('Nenhum log para exportar.');
      return;
    }

    // 3. Montagem e download do arquivo CSV
    const headers = ['Data/Hora', 'Usuário', 'Ação', 'Entidade', 'ID', 'Detalhe', 'IP'];
    const lines = rows.map(r => [
      r.criado_em ? new Date(r.criado_em).toLocaleString('pt-BR') : '',
      r.usuario_nome || '',
      r.acao || '',
      r.entidade || '',
      r.entidade_id || '',
      (r.detalhe || '').replace(/"/g, '""'),
      r.ip || ''
    ].map(v => `"${v}"`).join(';'));

    const csv = '\uFEFF' + [headers.join(';'), ...lines].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs_auditoria_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Erro na exportação:', err);
    showToast('Erro ao exportar logs.');
  }
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
const TIPOS_USUARIO = ['Administrador', 'Gerente de Logística', 'Gerente', 'Operador', 'Vendedor'];

function applyLoggedUser() {
  if (!currentUser) return;
  const tipo = currentUser.tipo;

  // Avatar e nome na sidebar
  const initials = currentUser.nome.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase();
  document.getElementById('user-av').innerText = initials || '?';
  document.getElementById('user-name').innerText = currentUser.nome;
  document.getElementById('user-role').innerText = tipo;
  document.getElementById('user-pill').setAttribute('data-tooltip', `${currentUser.nome} — ${tipo}`);

  // ── Permissões por tipo ──────────────────────────────────────
  const PODE_CRUD_PEDIDO = ['Administrador', 'Gerente de Logística', 'Operador'].includes(tipo);
  const PODE_VER_ADMIN = ['Administrador', 'Gerente de Logística', 'Operador'].includes(tipo);
  const PODE_CRUD_USUARIO = ['Administrador', 'Gerente de Logística'].includes(tipo);
  const IS_VENDEDOR = tipo === 'Vendedor';
  const IS_GERENTE = tipo === 'Gerente';

  // ── Aba Administração ────────────────────────────────────────
  const adminMenuItem = document.querySelector('.sb-nav li[data-tooltip="Administração"]');
  if (adminMenuItem) {
    adminMenuItem.style.display = PODE_VER_ADMIN ? 'flex' : 'none';
    if (!PODE_VER_ADMIN && document.getElementById('tab-administracao')?.classList.contains('active')) {
      showTab('dashboard', document.querySelector('.sb-nav li:nth-child(1)'));
    }
  }

  // ── Aba Logs (apenas Administrador) ─────────────────────────
  const IS_ADMIN = tipo === 'Administrador';
  const logsMenuItem = document.getElementById('nav-logs');
  if (logsMenuItem) {
    logsMenuItem.style.display = IS_ADMIN ? 'flex' : 'none';
    if (!IS_ADMIN && document.getElementById('tab-logs')?.classList.contains('active')) {
      showTab('dashboard', document.querySelector('.sb-nav li:nth-child(1)'));
    }
  }

  // ── Botões da topbar ─────────────────────────────────────────
  const btnImportar = document.querySelector('[onclick="openModal()"]');
  const btnManual = document.querySelector('[onclick="openManualModal()"]');
  const btnExportar = document.querySelector('[onclick="exportCSV()"]');

  if (btnImportar) btnImportar.style.display = PODE_CRUD_PEDIDO ? '' : 'none';
  if (btnManual) btnManual.style.display = PODE_CRUD_PEDIDO ? '' : 'none';
  // Exportar é visível para todos os perfis
  if (btnExportar) btnExportar.style.display = '';

  // ── Filtro de vendedor (Vendedor só vê os próprios) ──────────
  const fVend = document.getElementById('f-vend');
  if (fVend) fVend.style.display = IS_VENDEDOR ? 'none' : '';
}

async function logout() {
  if (!currentUser) return;
  fecharPerfilModal();
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch (e) { } // Força a limpeza local mesmo se falhar
  currentUser = null;
  sessionStorage.removeItem('fortecare_session');
  window.location.replace('login.html');
}

// ── CRUD DE USUÁRIOS (aba Administração via API) ───────
async function loadAndRenderUsersPanel() {
  const card = document.getElementById('admin-users-card');
  if (!card) return;

  const tipo = currentUser?.tipo;
  const PODE_VER_ADMIN = ['Administrador', 'Gerente de Logística', 'Operador'].includes(tipo);
  const PODE_CRUD_USUARIO = ['Administrador', 'Gerente de Logística'].includes(tipo);
  const PODE_DEPARA = ['Administrador', 'Gerente de Logística', 'Operador'].includes(tipo);

  if (!PODE_VER_ADMIN) {
    card.innerHTML = `<div class="chart-title" style="margin-bottom:12px">Gestão de Usuários</div>
      <p style="font-size:13px;color:var(--muted)">Sem permissão de acesso.</p>`;
    return;
  }

  card.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:12px">Carregando usuários…</div>`;

  try {
    const res = await apiFetch('/api/usuarios/');
    const users = await res.json();
    window.loadedUsers = users;

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div class="chart-title" style="margin:0">Gestão de Usuários</div>
        ${PODE_CRUD_USUARIO ? `<button class="btn btn-primary" style="font-size:12px" onclick="openUserModal()">+ Novo Usuário</button>` : ''}
      </div>
      <div class="t-scroll">
        <table>
          <thead><tr><th>Nome</th><th>E-mail</th><th>Setor</th><th>Tipo</th><th>Status</th>${PODE_CRUD_USUARIO ? '<th>Ações</th>' : ''}</tr></thead>
          <tbody>
            ${users.map(u => {
      const isAdmin = u.tipo === 'Administrador';
      const podeAlterar = PODE_CRUD_USUARIO && !(isAdmin && tipo !== 'Administrador');
      return `<tr>
                <td>${escapeHtml(u.nome)}</td>
                <td>${escapeHtml(u.email)}</td>
                <td>${escapeHtml(u.setor || '-')}</td>
                <td><span class="badge bT">${escapeHtml(u.tipo)}</span></td>
                <td><span class="badge ${u.ativo ? 'bE' : 'bR'}">${u.ativo ? 'Ativo' : 'Inativo'}</span></td>
                ${PODE_CRUD_USUARIO ? `<td>
                  ${podeAlterar ? `<button class="delete-btn" title="Editar" onclick="openUserModal(${u.id})">✏️</button>` : '<span style="color:var(--muted);font-size:11px">—</span>'}
                  ${podeAlterar ? `<button class="delete-btn" title="Excluir" onclick="deleteUser(${u.id}, '${escapeHtml(u.nome)}')">🗑</button>` : ''}
                </td>` : ''}
              </tr>`;
    }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    card.innerHTML = `<p style="color:red;font-size:13px">Erro ao carregar usuários.</p>`;
  }
}

function openUserModal(id) {
  const isEdit = !!id;
  const tipo = currentUser?.tipo;

  document.getElementById('user-modal-title').innerText = isEdit ? 'Editar Usuário' : 'Novo Usuário';
  document.getElementById('user-modal-error').style.display = 'none';
  document.getElementById('u-edit-id').value = id || '';

  // Filtra opções de tipo conforme permissão
  const selectTipo = document.getElementById('u-tipo');
  if (selectTipo) {
    const adminOpt = selectTipo.querySelector('option[value="Administrador"]');
    if (adminOpt) adminOpt.style.display = tipo === 'Administrador' ? '' : 'none';
  }

  if (isEdit && window.loadedUsers) {
    const user = window.loadedUsers.find(u => u.id === id);
    if (!user) return;
    document.getElementById('u-nome').value = user.nome;
    document.getElementById('u-email').value = user.email;
    document.getElementById('u-senha').value = '';
    document.getElementById('u-setor').value = user.setor || '';
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
  } catch (e) {
    errorEl.innerText = 'Falha na comunicação com o servidor.';
    errorEl.style.display = 'block';
  }
}

async function deleteUser(id, nome) {
  if (currentUser && currentUser.id === id) { alert('Você não pode excluir o próprio usuário logado.'); return; }
  if (!confirm(`Tem certeza que deseja excluir permanentemente o usuário "${nome}"?`)) return;

  try {
    const res = await apiFetch(`/api/usuarios/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Usuário excluído.');
      loadAndRenderUsersPanel();
    } else {
      const err = await res.json();
      alert(err.detail || 'Erro ao excluir usuário.');
    }
  } catch (e) { showToast('Falha na comunicação com o servidor.'); }
}

// ═══════════════════════════════════════════════
// ABAS DE PERFORMANCE (MANTIDAS IGUAIS)
// ═══════════════════════════════════════════════
function renderTransportadoras() {
  const grid = document.getElementById('transp-grid');
  if (!grid) return;
  const dFrom = document.getElementById('f-transp-from')?.value, dTo = document.getElementById('f-transp-to')?.value, hoje = todayMidnight(), transportadoras = {};

  dataSET.forEach(p => {
    if (dFrom && p.emissao < dFrom) return;
    if (dTo && p.emissao > dTo) return;
    const t = p.transportadora;
    if (!transportadoras[t]) transportadoras[t] = { name: t, total: 0, entregues: 0, transito: 0, faturamento: 0, frete: 0, noPrazo: 0, atraso: 0 };
    transportadoras[t].total++; transportadoras[t].faturamento += (p.valorNF || 0); transportadoras[t].frete += (p.valorC || 0);
    if (p.status.toUpperCase() === 'ENTREGUE') {
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
    const iniciais = t.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
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
  if (!grid) return;
  const dFrom = document.getElementById('f-vend-from')?.value, dTo = document.getElementById('f-vend-to')?.value, hoje = todayMidnight(), vendedores = {};

  dataSET.forEach(p => {
    if (dFrom && p.emissao < dFrom) return;
    if (dTo && p.emissao > dTo) return;
    const v = p.vendedor;
    if (!vendedores[v]) vendedores[v] = { name: v, pedidos: 0, faturamento: 0, frete: 0, entregues: 0, noPrazo: 0, atraso: 0 };
    vendedores[v].pedidos++; vendedores[v].faturamento += (p.valorNF || 0); vendedores[v].frete += (p.valorC || 0);
    if (p.status.toUpperCase() === 'ENTREGUE') {
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
    const pctVolumeTotal = Math.round((v.faturamento / maiorFaturamento) * 100), ticketMedio = v.pedidos > 0 ? (v.faturamento / v.pedidos) : 0, baseSLA = v.noPrazo + v.atraso, sla = baseSLA > 0 ? Math.round((v.noPrazo / baseSLA) * 100) : 100, kpiFrete = v.faturamento > 0 ? ((v.frete / v.faturamento) * 100).toFixed(1) : 0, iniciais = v.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    return `
      <div class="perf-card">
        <div class="perf-header"><div class="perf-av" style="background:var(--blue)">${iniciais}</div><div><div class="perf-name">${v.name}</div><div class="perf-count">${v.pedidos} vendas fechadas</div></div></div>
        <div class="perf-stats">
          <div class="ps-block" style="background:var(--teal-pale);color:#006B4C"><div class="ps-val">${v.noPrazo}</div><div class="ps-lbl">No Prazo</div></div>
          <div class="ps-block" style="background:var(--red-pale);color:#991B1B"><div class="ps-val">${v.atraso}</div><div class="ps-lbl">Atraso</div></div>
          <div class="ps-block" style="background:var(--blue-pale);color:var(--blue)"><div class="ps-val">${sla}%</div><div class="ps-lbl">N. SERVIÇO</div></div>
        </div>
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
  const tbodyEl = document.getElementById('tabela-de-para');

  // Carrega usuários no select
  if (selectEl) {
    selectEl.innerHTML = '<option value="">Carregando usuários...</option>';
    try {
      const res = await apiFetch('/api/usuarios/');
      if (!res) return;
      const users = await res.json();
      selectEl.innerHTML = '<option value="">Selecione um usuário</option>' +
        users
          .filter(u => u.ativo && u.tipo === 'Vendedor') // <-- Filtro ajustado aqui
          .map(u =>
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

// ═══════════════════════════════════════════════
// MODAL PERFIL DO USUÁRIO
// ═══════════════════════════════════════════════
function abrirPerfilModal() {
  if (!currentUser) return;

  const tipo = currentUser.tipo;
  const initials = currentUser.nome
    .split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase();

  document.getElementById('perfil-av-grande').innerText = initials || '?';
  document.getElementById('perfil-titulo').innerText = currentUser.nome;
  document.getElementById('perfil-cargo').innerText = tipo;
  document.getElementById('perfil-nome').value = currentUser.nome;
  document.getElementById('perfil-senha').value = '';
  document.getElementById('perfil-confirma').value = '';
  document.getElementById('perfil-confirma-wrap').style.display = 'none';

  const errEl = document.getElementById('perfil-error');
  const okEl = document.getElementById('perfil-success');
  errEl.style.display = 'none';
  okEl.style.display = 'none';

  const btn = document.getElementById('perfil-btn-salvar');
  btn.innerText = 'Salvar';
  btn.disabled = false;

  // Mostra campo de confirmação só ao digitar nova senha
  document.getElementById('perfil-senha').oninput = function () {
    document.getElementById('perfil-confirma-wrap').style.display =
      this.value.length > 0 ? 'block' : 'none';
  };

  document.getElementById('perfil-overlay').style.display = 'flex';
}

function fecharPerfilModal(event) {
  // Se chamado pelo onclick do backdrop, só fecha ao clicar no próprio overlay
  if (event && event.target !== document.getElementById('perfil-overlay')) return;
  document.getElementById('perfil-overlay').style.display = 'none';
}

async function salvarPerfil() {
  const nome = document.getElementById('perfil-nome').value.trim();
  const senha = document.getElementById('perfil-senha').value;
  const confirma = document.getElementById('perfil-confirma').value;
  const errEl = document.getElementById('perfil-error');
  const okEl = document.getElementById('perfil-success');
  const btn = document.getElementById('perfil-btn-salvar');

  errEl.style.display = 'none';
  okEl.style.display = 'none';

  if (!nome) {
    errEl.innerText = 'O nome não pode ficar em branco.';
    errEl.style.display = 'block';
    document.getElementById('perfil-nome').focus();
    return;
  }

  if (senha) {
    if (senha.length < 6) {
      errEl.innerText = 'A senha deve ter no mínimo 6 caracteres.';
      errEl.style.display = 'block';
      return;
    }
    if (senha !== confirma) {
      errEl.innerText = 'As senhas não coincidem.';
      errEl.style.display = 'block';
      return;
    }
  }

  btn.innerText = 'Salvando…';
  btn.disabled = true;

  try {
    const payload = { nome };
    if (senha) payload.nova_senha = senha;

    const res = await apiFetch('/api/auth/meu-perfil', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      errEl.innerText = data.detail || 'Erro ao salvar perfil.';
      errEl.style.display = 'block';
      btn.innerText = 'Salvar';
      btn.disabled = false;
      return;
    }

    // Atualiza sessão local
    currentUser.nome = nome;
    if (senha) currentUser.primeiro_acesso = false;
    sessionStorage.setItem('fortecare_session', JSON.stringify(currentUser));
    applyLoggedUser();

    okEl.innerText = senha ? 'Nome e senha atualizados com sucesso!' : 'Nome atualizado com sucesso!';
    okEl.style.display = 'block';

    // Fecha o modal após 1.8 s
    setTimeout(() => {
      document.getElementById('perfil-overlay').style.display = 'none';
    }, 1800);

  } catch (err) {
    errEl.innerText = 'Não foi possível conectar ao servidor.';
    errEl.style.display = 'block';
    btn.innerText = 'Salvar';
    btn.disabled = false;
  }
}