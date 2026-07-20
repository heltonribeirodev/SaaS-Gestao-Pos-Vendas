// ═══════════════════════════════════════════════
// ESTADO GLOBAL DO APLICATIVO
// ═══════════════════════════════════════════════
// Base de dados em memória — populada via importação de CSV/XLSX
let dataSET = [];

// Atribui um identificador interno único a cada pedido (o #NF pode se repetir,
// então não serve como chave para localizar/editar um registro específico)
dataSET.forEach((item, index) => { item._rowId = index; });
let nextRowId = dataSET.length;

let filteredData = [...dataSET];
let currentPage = 1;
const rowsPerPage = 10;
let currentSort = { col: 'id', asc: true };
let urgencyFilter = null; // null | 'hoje' | 'atraso' — acionado pelos cards do Dashboard

const STATUS_OPTIONS = ['ENTREGUE', 'EM TRÂNSITO', 'EM ROTA'];

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// % de frete é sempre calculado pelo app (nunca importado/digitado), pra nunca ficar
// desalinhado do Valor NF / Valor Frete reais que estão na tela.
function calcPct(valorNF, valorC) {
  return valorNF > 0 ? +((valorC / valorNF) * 100).toFixed(2) : 0;
}

function findByRowId(rowId) {
  return dataSET.find(i => i._rowId === Number(rowId));
}

// Converte "dd/mm/aaaa" em Date (meia-noite local), retorna null se inválido/vazio
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

// Pedido ainda pendente = não entregue e não cancelado (é o que o operador precisa agir)
function isPending(item) {
  const s = (item.status || '').toUpperCase();
  return !s.startsWith('ENTREGUE') && !s.startsWith('CANCEL');
}

// Painel do Dashboard (Visão Geral) é sempre referente ao mês atual, independente
// dos filtros aplicados na aba Pedidos — é um "raio-x" rápido e confiável do mês corrente.
// Para análises históricas/comparativas, o usuário usa o BI dele.
function getCurrentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getDashboardData() {
  const monthKey = getCurrentMonthKey();
  return dataSET.filter(i => (i.emissao || '').slice(0, 7) === monthKey);
}

// O campo "entrega" é guardado como dd/mm/aaaa (igual "previsao"),
// mas o <input type="date"> exige aaaa-mm-dd. Estas funções convertem entre os dois formatos.
function brToIso(str) {
  if (!str || !str.includes('/')) return '';
  const [d, m, y] = str.split('/');
  if (!d || !m || !y) return '';
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

function isoToBr(str) {
  if (!str || !str.includes('-')) return '';
  const [y, m, d] = str.split('-');
  if (!d || !m || !y) return '';
  return `${d}/${m}/${y}`;
}

// O Excel pode entregar uma data de 3 formas: célula de data real (Date/serial numérico),
// texto "dd/mm/aaaa" ou texto "aaaa-mm-dd". Estas funções normalizam qualquer uma delas.
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

// Instâncias dos Gráficos (para destruição e recriação limpa)
let chartStatusInstance = null;
let chartVendInstance = null;
let chartTranspInstance = null;

// Cores do Tema (Sincronizadas com o CSS)
const colors = {
  blue: '#1B6FD5', teal: '#00A878', amber: '#F59E0B', orange: '#F97316', red: '#EF4444',
  muted: '#6B7FA3', border: '#DDE6F5', navy: '#002B5C'
};

// Formatação de Moeda
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
// INICIALIZAÇÃO DA APLICAÇÃO
// ═══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // Carrega sessão do login.html via sessionStorage
  try {
    const session = JSON.parse(sessionStorage.getItem('fortecare_session'));
    if (session) currentUser = session;
  } catch {}

  applyLoggedUser();
  buildFilterDropdowns();
  renderDashboard();   // só a aba inicial — lazy render para as demais
  renderPedidos();

  // Busca rápida global (opcional — só ativa se o campo existir no HTML)
  const gSearch = document.getElementById('g-search');
  if (gSearch) {
    gSearch.addEventListener('input', (e) => {
      const fq = document.getElementById('f-q');
      if (fq) fq.value = e.target.value;
      applyFilters();
    });
  }
});

// Alimenta os elementos select dinamicamente baseado nos dados atuais
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

// Renderiza apenas o necessário — abas pesadas (transportadoras/vendedores)
// só são renderizadas quando o usuário navegar até elas.
function executeDataRefresh() {
  renderDashboard();
  renderPedidos();
  const activeTab = document.querySelector('.tab.active');
  if (activeTab && activeTab.id === 'tab-transportadoras') renderTransportadoras();
  if (activeTab && activeTab.id === 'tab-vendedores') renderVendedores();
}

// Navegação de Abas
function showTab(tabId, element) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tabId).classList.add('active');

  document.querySelectorAll('.sb-nav li').forEach(li => li.classList.remove('active'));
  if (element) element.classList.add('active');

  const titles = { dashboard: 'Dashboard', pedidos: 'Pedidos', transportadoras: 'Transportadoras', vendedores: 'Vendedores', administracao: 'Administração' };
  document.getElementById('top-title').innerText = titles[tabId] || 'ForteCare';

  // Lazy render: só renderiza a aba pesada quando o usuário acessar pela primeira vez
  if (tabId === 'transportadoras') renderTransportadoras();
  if (tabId === 'vendedores') renderVendedores();
  if (tabId === 'administracao') renderUsersPanel();
}

// ═══════════════════════════════════════════════
// ENGINE DE FILTROS E DATAS
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
      const match = (item.destinatario || '').toLowerCase().includes(fQuery) ||
                    (item.municipio || '').toLowerCase().includes(fQuery) ||
                    String(item.id).includes(fQuery);
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
  renderDashboard();
  renderPedidos();
  // Transportadoras e Vendedores têm filtros próprios; só re-renderiza se estiver na aba ativa
  const activeTab = document.querySelector('.tab.active');
  if (activeTab && activeTab.id === 'tab-transportadoras') renderTransportadoras();
  if (activeTab && activeTab.id === 'tab-vendedores') renderVendedores();
}

function goToUrgent(type) {
  showTab('pedidos', document.querySelector('.sb-nav li:nth-child(2)'));
  document.getElementById('f-status').value = '';
  document.getElementById('f-vend').value = '';
  document.getElementById('f-transp').value = '';
  document.getElementById('f-uf').value = '';
  document.getElementById('f-q').value = '';
  document.getElementById('f-dfrom').value = '';
  document.getElementById('f-dto').value = '';
  document.getElementById('period-tag').style.display = 'none';
  document.querySelectorAll('.qchip').forEach(c => c.classList.remove('active'));

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
  let de = new Date();
  let ate = new Date();

  switch(preset) {
    case 'hoje':
      break;
    case '7d':
      de.setDate(hoje.getDate() - 7);
      break;
    case 'semana':
      const diaSemana = hoje.getDay();
      de.setDate(hoje.getDate() - diaSemana);
      break;
    case 'mes':
      de = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      break;
    case 'mesant':
      de = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
      ate = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
      break;
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
// RENDERIZADOR: DASHBOARD & GRÁFICOS (CHART.JS)
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

  // Chip fixo indicando o escopo do painel (sempre mês atual, não depende de filtros)
  const mesNomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const agora = new Date();
  document.getElementById('chip-date').innerText = `${mesNomes[agora.getMonth()]} de ${agora.getFullYear()}`;

  // Última data de emissão dentro do mês atual
  const emissoesValidas = data.map(i => i.emissao).filter(Boolean).sort();
  const chipEmissao = document.getElementById('chip-last-emissao');
  if (emissoesValidas.length > 0) {
    chipEmissao.innerText = `Última emissão: ${formatDateToBr(emissoesValidas[emissoesValidas.length - 1])}`;
    chipEmissao.style.display = 'inline-flex';
  } else {
    chipEmissao.style.display = 'none';
  }

  // ── Painel de suporte ao operador (tudo referente ao mês atual) ──
  let entregarHoje = 0;      // pendentes com previsão = hoje
  let emAtraso = 0;          // pendentes com previsão já vencida (ainda não entregues)
  let entreguesNoPrazo = 0;  // entregues até a data prevista
  let entreguesAtrasados = 0;// entregues, mas depois da data prevista

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
      if (entregaDate && prev && entregaDate.getTime() > prev.getTime()) {
        entreguesAtrasados++;
      } else {
        entreguesNoPrazo++;
      }
    }
  });

  const totalAtrasos = emAtraso + entreguesAtrasados;

  document.getElementById('kpi-hoje').innerText = entregarHoje;
  document.getElementById('kpi-atraso').innerText = emAtraso;
  document.getElementById('card-atraso').classList.toggle('is-alert', emAtraso > 0);
  document.getElementById('card-hoje').classList.toggle('is-alert', entregarHoje > 0);

  // Total de entregas atrasadas no mês (pendentes vencidas + entregues fora do prazo)
  document.getElementById('kpi-atrasos-total').innerText = totalAtrasos;

  // Nível de Serviço: % de pedidos já "resolvidos dentro do prazo" (entregues no prazo)
  // sobre o total de pedidos que já tiveram seu prazo definitivamente cumprido ou perdido
  // (entregues no prazo + entregues atrasados + ainda pendentes e vencidos).
  // Pedidos ainda dentro do prazo (previsão futura) não entram na conta — o prazo deles ainda não foi decidido.
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

  // % Frete Médio do mês: soma de todo o frete / soma de todo o Valor NF do período
  // (média ponderada — mais fiel à realidade financeira do que a média simples dos %)
  const totalValorNFmes = data.reduce((acc, i) => acc + (i.valorNF || 0), 0);
  const totalFretemes = data.reduce((acc, i) => acc + (i.valorC || 0), 0);
  const freteMedio = totalValorNFmes > 0 ? (totalFretemes / totalValorNFmes) * 100 : null;
  document.getElementById('kpi-frete').innerText = freteMedio === null ? '–' : freteMedio.toFixed(1) + '%';

  // Renderizar minitabela do Dashboard (Últimos 5 registros do mês atual)
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
  // Destruir instâncias velhas para evitar sobreposição ao passar o mouse
  if (chartStatusInstance) chartStatusInstance.destroy();
  if (chartVendInstance) chartVendInstance.destroy();
  if (chartTranspInstance) chartTranspInstance.destroy();

  // 1. DADOS DE STATUS
  const statusCounts = { 'ENTREGUE': 0, 'EM TRÂNSITO': 0, 'EM ROTA': 0};
  data.forEach(i => {
    let s = i.status.toUpperCase();
    if (statusCounts[s] !== undefined) statusCounts[s]++;
  });

  const ctxStatus = document.getElementById('c-status');
  if (ctxStatus) {
    chartStatusInstance = new Chart(ctxStatus, {
      type: 'doughnut',
      data: {
        labels: Object.keys(statusCounts),
        datasets: [{
          data: Object.values(statusCounts),
          backgroundColor: [colors.teal, colors.amber, colors.orange, colors.red],
          borderWidth: 2, hoverOffset: 4
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } }
      }
    });

    // Atualiza a legenda customizada abaixo do gráfico de rosca
    const total = data.length;
    document.getElementById('status-legend').innerHTML = Object.keys(statusCounts).map((key, index) => {
      const color = [colors.teal, colors.amber, colors.orange, colors.red][index];
      const count = statusCounts[key];
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      return `
        <div class="sl-row">
          <div class="sl-left"><div class="sl-dot" style="background:${color}"></div>${key}</div>
          <div class="sl-count">${count} <span style="color:var(--muted);font-weight:400">(${pct}%)</span></div>
        </div>`;
    }).join('');
  }

  // 2. DADOS DE VENDEDOR
  const vendData = {};
  data.forEach(i => { vendData[i.vendedor] = (vendData[i.vendedor] || 0) + i.valorNF; });
  
  const ctxVend = document.getElementById('c-vend');
  if (ctxVend) {
    chartVendInstance = new Chart(ctxVend, {
      type: 'bar',
      data: {
        labels: Object.keys(vendData),
        datasets: [{
          label: 'Faturamento', data: Object.values(vendData),
          backgroundColor: colors.blue, borderRadius: 6
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { grid: { display: false }, ticks: { font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } }
      }
    });
  }

  // 3. DADOS DE TRANSPORTADORA
  const transpData = {};
  data.forEach(i => { transpData[i.transportadora] = (transpData[i.transportadora] || 0) + 1; });

  const ctxTransp = document.getElementById('c-transp');
  if (ctxTransp) {
    chartTranspInstance = new Chart(ctxTransp, {
      type: 'polarArea',
      data: {
        labels: Object.keys(transpData),
        datasets: [{
          data: Object.values(transpData),
          backgroundColor: [colors.blue + 'CC', colors.teal + 'CC', colors.amber + 'CC', colors.orange + 'CC']
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { r: { ticks: { display: false } } }
      }
    });
  }
}

// ═══════════════════════════════════════════════
// RENDERIZADOR: TELA PRINCIPAL DE PEDIDOS
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

  // Aplica ordenação ativa
  filteredData.sort((a, b) => {
    let valA = a[currentSort.col];
    let valB = b[currentSort.col];
    
    if (typeof valA === 'string') {
      return currentSort.asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    } else {
      return currentSort.asc ? valA - valB : valB - valA;
    }
  });

  // Paginação física dos dados
  const idxStart = (currentPage - 1) * rowsPerPage;
  const idxEnd = idxStart + rowsPerPage;
  const paginatedItems = filteredData.slice(idxStart, idxEnd);

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
               onchange="updateEntrega(${item._rowId}, this.value)">
      </td>
      <td>
        <input type="text" class="contato-edit-input" value="${escapeHtml(item.contato)}"
               placeholder="Sem contato" onchange="updateContato(${item._rowId}, this.value)">
      </td>
      <td>
        <div class="frete-edit-wrap">
          <input type="number" step="0.01" min="0" class="frete-edit-input"
                 value="${item.valorC ?? 0}"
                 onchange="updateFrete(${item._rowId}, this.value)">
          <span class="frete-pct" title="% de frete sobre o Valor NF (calculado automaticamente)">${calcPct(item.valorNF, item.valorC).toFixed(1)}%</span>
        </div>
      </td>
      <td>
        <select class="status-edit ${getBadgeClass(item.status)}" onchange="updateStatus(${item._rowId}, this.value)">
          ${STATUS_OPTIONS.map(s => `<option value="${s}" ${item.status.toUpperCase() === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </td>
      <td>
        <div class="obs-edit-wrap">
          <input type="text" class="obs-edit-input" id="obs-${item._rowId}"
                 value="${escapeHtml(item.obs)}" placeholder="Sem observação"
                 onchange="updateObs(${item._rowId}, this.value)">
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

// ═══════════════════════════════════════════════
// EDIÇÃO INLINE: STATUS E OBSERVAÇÕES
// ═══════════════════════════════════════════════
function updateStatus(rowId, newStatus) {
  const item = findByRowId(rowId);
  if (!item) return;
  item.status = newStatus;
  renderDashboard(); // status afeta KPIs e gráficos do dashboard
  renderPedidos();   // atualiza badge na tabela
  showToast('Status atualizado.');
}

function updateObs(rowId, newObs) {
  const item = findByRowId(rowId);
  if (!item) return;
  item.obs = newObs.trim();
  renderPedidos(); // obs não afeta KPIs/gráficos, só a tabela
  showToast(item.obs ? 'Observação salva.' : 'Observação removida.');
}

function clearObs(rowId) {
  const input = document.getElementById('obs-' + rowId);
  if (input) input.value = '';
  updateObs(rowId, '');
}

function updateContato(rowId, newContato) {
  const item = findByRowId(rowId);
  if (!item) return;
  item.contato = newContato.trim();
  renderPedidos();
  showToast('Contato salvo.');
}

function updateEntrega(rowId, newIsoDate) {
  const item = findByRowId(rowId);
  if (!item) return;
  item.entrega = isoToBr(newIsoDate);
  renderPedidos();
  showToast(item.entrega ? 'Data de entrega salva.' : 'Data de entrega removida.');
}

function updateFrete(rowId, newValue) {
  const item = findByRowId(rowId);
  if (!item) return;
  item.valorC = parseFloat(newValue) || 0;
  item.pct = calcPct(item.valorNF, item.valorC);
  renderPedidos();
  showToast('Valor de frete atualizado.');
}

function deleteRecord(rowId) {
  const item = findByRowId(rowId);
  if (!item) return;
  const confirmMsg = `Excluir o pedido #${item.id} (${item.destinatario})? Essa ação não pode ser desfeita.`;
  if (!confirm(confirmMsg)) return;

  dataSET = dataSET.filter(i => i._rowId !== Number(rowId));
  buildFilterDropdowns();
  applyFilters();
  showToast('Registro excluído.');
}

function formatDateToBr(str) {
  if(!str || !str.includes('-')) return str;
  const parts = str.split('-');
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function buildPaginationControls() {
  const pagContainer = document.getElementById('pag');
  const totalPages = Math.ceil(filteredData.length / rowsPerPage);
  
  if (totalPages <= 1) {
    pagContainer.innerHTML = '';
    return;
  }

  let html = `<button class="pb" ${currentPage === 1 ? 'disabled' : ''} onclick="changePage(${currentPage - 1})">‹</button>`;

  const delta = 2; // páginas visíveis em volta da atual
  const pages = new Set();
  pages.add(1);
  pages.add(totalPages);
  for (let i = Math.max(2, currentPage - delta); i <= Math.min(totalPages - 1, currentPage + delta); i++) {
    pages.add(i);
  }
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

function changePage(p) {
  currentPage = p;
  renderPedidos();
}

function sortBy(columnKey) {
  if (currentSort.col === columnKey) {
    currentSort.asc = !currentSort.asc;
  } else {
    currentSort.col = columnKey;
    currentSort.asc = true;
  }
  renderPedidos();
}

// ═══════════════════════════════════════════════
// ABAS DE PERFORMANCE: VENDEDORES E TRANSPORTADORAS
// ═══════════════════════════════════════════════
function renderTransportadoras() {
  const grid = document.getElementById('transp-grid');
  if(!grid) return;

  const dFrom = document.getElementById('f-transp-from')?.value;
  const dTo = document.getElementById('f-transp-to')?.value;

  const transportadoras = {};
  const hoje = todayMidnight();

  dataSET.forEach(p => {
    if (dFrom && p.emissao < dFrom) return;
    if (dTo && p.emissao > dTo) return;

    const t = p.transportadora;
    if(!transportadoras[t]) {
      transportadoras[t] = { name: t, total: 0, entregues: 0, transito: 0, faturamento: 0, frete: 0, noPrazo: 0, atraso: 0 };
    }
    transportadoras[t].total++;
    transportadoras[t].faturamento += (p.valorNF || 0);
    transportadoras[t].frete += (p.valorC || 0);

    if(p.status.toUpperCase() === 'ENTREGUE') {
      transportadoras[t].entregues++;
      const entregaDt = parseBrDate(p.entrega);
      const previsaoDt = parseBrDate(p.previsao);
      if (entregaDt && previsaoDt && entregaDt.getTime() > previsaoDt.getTime()) {
        transportadoras[t].atraso++;
      } else {
        transportadoras[t].noPrazo++;
      }
    } else if (p.status.toUpperCase() === 'EM TRÂNSITO') {
      transportadoras[t].transito++;
    }

    if (isPending(p)) {
       const previsaoDt = parseBrDate(p.previsao);
       if (previsaoDt && previsaoDt.getTime() < hoje.getTime()) {
         transportadoras[t].atraso++;
       }
    }
  });

  grid.innerHTML = Object.values(transportadoras).map(t => {
    const baseSLA = t.noPrazo + t.atraso;
    const sla = baseSLA > 0 ? Math.round((t.noPrazo / baseSLA) * 100) : 100;
    const kpiFrete = t.faturamento > 0 ? ((t.frete / t.faturamento) * 100).toFixed(1) : 0;
    const iniciais = t.name.split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase();

    return `
      <div class="perf-card">
        <div class="perf-header">
          <div class="perf-av" style="background:var(--navy)">${iniciais}</div>
          <div>
            <div class="perf-name">${t.name}</div>
            <div class="perf-count">${t.total} envios registrados</div>
          </div>
        </div>
        <div class="perf-stats">
          <div class="ps-block" style="background:var(--teal-pale);color:#006B4C">
            <div class="ps-val">${t.noPrazo}</div><div class="ps-lbl">No Prazo</div>
          </div>
          <div class="ps-block" style="background:var(--red-pale);color:#991B1B">
            <div class="ps-val">${t.atraso}</div><div class="ps-lbl">Atraso</div>
          </div>
          <div class="ps-block" style="background:var(--amber-pale);color:#92660A">
            <div class="ps-val">${t.transito}</div><div class="ps-lbl">Curso</div>
          </div>
        </div>
        <div class="pbar-wrap">
          <div class="pbar-top">
            <span class="pbar-lbl">Nível de Serviço</span><strong>${sla}%</strong>
          </div>
          <div class="pbar-bg"><div class="pbar-fill" style="width:${sla}%; background:var(--teal)"></div></div>
        </div>
        <div style="margin-top:14px; font-size:12px; display:flex; flex-direction:column; gap:4px; border-top:1px solid var(--border); padding-top:10px;">
          <div style="display:flex; justify-content:space-between;">
            <span style="color:var(--muted)">Faturamento:</span>
            <strong style="color:var(--text)">${formatMoney(t.faturamento)}</strong>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span style="color:var(--muted)">Total Frete:</span>
            <strong style="color:var(--text)">${formatMoney(t.frete)}</strong>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span style="color:var(--muted)">KPI % Frete:</span>
            <strong style="color:var(--blue)">${kpiFrete}%</strong>
          </div>
        </div>
      </div>`;
  }).join('');
}

function renderVendedores() {
  const grid = document.getElementById('vend-grid');
  if(!grid) return;

  const dFrom = document.getElementById('f-vend-from')?.value;
  const dTo = document.getElementById('f-vend-to')?.value;

  const vendedores = {};
  const hoje = todayMidnight();

  dataSET.forEach(p => {
    if (dFrom && p.emissao < dFrom) return;
    if (dTo && p.emissao > dTo) return;

    const v = p.vendedor;
    if(!vendedores[v]) {
      vendedores[v] = { name: v, pedidos: 0, faturamento: 0, frete: 0, entregues: 0, noPrazo: 0, atraso: 0 };
    }
    vendedores[v].pedidos++;
    vendedores[v].faturamento += (p.valorNF || 0);
    vendedores[v].frete += (p.valorC || 0);

    if(p.status.toUpperCase() === 'ENTREGUE') {
      vendedores[v].entregues++;
      const entregaDt = parseBrDate(p.entrega);
      const previsaoDt = parseBrDate(p.previsao);
      if (entregaDt && previsaoDt && entregaDt.getTime() > previsaoDt.getTime()) {
        vendedores[v].atraso++;
      } else {
        vendedores[v].noPrazo++;
      }
    }

    if (isPending(p)) {
       const previsaoDt = parseBrDate(p.previsao);
       if (previsaoDt && previsaoDt.getTime() < hoje.getTime()) {
         vendedores[v].atraso++;
       }
    }
  });

  const maiorFaturamento = Math.max(...Object.values(vendedores).map(v => v.faturamento), 1);

  grid.innerHTML = Object.values(vendedores).map(v => {
    const pctVolumeTotal = Math.round((v.faturamento / maiorFaturamento) * 100);
    const ticketMedio = v.pedidos > 0 ? (v.faturamento / v.pedidos) : 0;
    const baseSLA = v.noPrazo + v.atraso;
    const sla = baseSLA > 0 ? Math.round((v.noPrazo / baseSLA) * 100) : 100;
    const kpiFrete = v.faturamento > 0 ? ((v.frete / v.faturamento) * 100).toFixed(1) : 0;
    const iniciais = v.name.split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase();

    return `
      <div class="perf-card">
        <div class="perf-header">
          <div class="perf-av" style="background:var(--blue)">${iniciais}</div>
          <div>
            <div class="perf-name">${v.name}</div>
            <div class="perf-count">${v.pedidos} vendas fechadas</div>
          </div>
        </div>
        <div class="perf-stats">
          <div class="ps-block" style="background:var(--teal-pale);color:#006B4C">
            <div class="ps-val">${v.noPrazo}</div><div class="ps-lbl">No Prazo</div>
          </div>
          <div class="ps-block" style="background:var(--red-pale);color:#991B1B">
            <div class="ps-val">${v.atraso}</div><div class="ps-lbl">Atraso</div>
          </div>
          <div class="ps-block" style="background:var(--blue-pale);color:var(--blue)">
            <div class="ps-val">${sla}%</div><div class="ps-lbl">SLA</div>
          </div>
        </div>
        <div style="background:var(--bg); border-radius:8px; padding:8px 10px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:11px;color:var(--muted)">TKT Médio:</span>
          <strong style="font-size:13px;color:var(--navy)">${formatMoney(ticketMedio)}</strong>
        </div>
        <div class="pbar-wrap">
          <div class="pbar-top">
            <span class="pbar-lbl">Performance vs Top Player</span><strong>${pctVolumeTotal}%</strong>
          </div>
          <div class="pbar-bg"><div class="pbar-fill" style="width:${pctVolumeTotal}%; background:var(--blue)"></div></div>
        </div>
        <div style="margin-top:14px; font-size:12px; display:flex; flex-direction:column; gap:4px; border-top:1px solid var(--border); padding-top:10px;">
          <div style="display:flex; justify-content:space-between;">
            <span style="color:var(--muted)">Faturamento:</span>
            <strong style="color:var(--teal)">${formatMoney(v.faturamento)}</strong>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span style="color:var(--muted)">Total Frete:</span>
            <strong style="color:var(--text)">${formatMoney(v.frete)}</strong>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span style="color:var(--muted)">KPI % Frete:</span>
            <strong style="color:var(--blue)">${kpiFrete}%</strong>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════
// IMPORTAÇÃO EXCEL (SHEETJS) & EXPORTAÇÃO CSV
// ═══════════════════════════════════════════════
function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  const ext = file.name.split('.').pop().toLowerCase();
  const isCSV = ext === 'csv';

  const reader = new FileReader();

  reader.onload = function(evt) {
    try {
      let rawRows = [];

      if (isCSV) {
        // ── Leitura de CSV ──────────────────────────────────────────
        // Detecta separador automaticamente (ponto-e-vírgula ou vírgula)
        const text = evt.target.result;
        const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
        if (lines.length < 2) {
          showToast("Atenção: o CSV importado está vazio ou sem dados.");
          return;
        }

        const sep = lines[0].includes(';') ? ';' : ',';
        const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, ''));

        rawRows = lines.slice(1).map(line => {
          // Divide respeitando aspas (campos com ; dentro de aspas)
          const cols = [];
          let cur = '', inQ = false;
          for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') { inQ = !inQ; continue; }
            if (c === sep && !inQ) { cols.push(cur.trim()); cur = ''; continue; }
            cur += c;
          }
          cols.push(cur.trim());

          const obj = {};
          headers.forEach((h, i) => { obj[h] = cols[i] ?? ''; });
          return obj;
        });

      } else {
        // ── Leitura de XLSX ─────────────────────────────────────────
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        rawRows = XLSX.utils.sheet_to_json(worksheet);
      }

      if (rawRows.length === 0) {
        showToast("Atenção: o arquivo importado está vazio.");
        return;
      }

      // ── Mapeamento das colunas para o padrão ForteCare ──────────
      // parseBR: converte número brasileiro "8.785,80" → 8785.80
      const parseBR = (v) => {
        if (v === undefined || v === null || v === '') return 0;
        return parseFloat(String(v).replace(/\./g, '').replace(',', '.')) || 0;
      };

      // Normaliza datas "01/01/0001" (sem previsão real) para vazio
      const normDate = (v) => {
        const br = excelToBrDate(v);
        if (!br || br.startsWith('01/01/0001') || br === '-') return '-';
        return br;
      };

      nextRowId = 0;
      dataSET = rawRows.map((r) => {
        // Colunas do seu CSV: NF, Vendedor, Destinatário, UF, Município,
        // Transportadora, Emissão, Valor NF, Valor Frete, Previsão
        const valorNF = parseBR(r['Valor NF']    || r['VALOR']  || r['Valor']);
        const valorC  = parseBR(r['Valor Frete'] || r['Frete']  || r['Custo']);

        return {
          _rowId:         nextRowId++,
          id:             r['NF'] || r['#NF'] || r['Nota'] || nextRowId,
          vendedor:       String(r['Vendedor']       || r['VENDEDOR']       || 'NÃO INFORMADO').toUpperCase().trim(),
          valorNF,
          valorC,
          pct:            calcPct(valorNF, valorC),
          transportadora: String(r['Transportadora'] || r['TRANSPORTADORA'] || 'RETIRA').toUpperCase().trim(),
          emissao:        excelToIsoDate(r['Emissão'] || r['Emissao'] || r['Data Emissão'] || r['Data Emissao']) || new Date().toISOString().split('T')[0],
          destinatario:   String(r['Destinatário']   || r['Destinatario']   || r['Cliente'] || 'NÃO INFORMADO').toUpperCase().trim(),
          uf:             String(r['UF']     || r['Estado'] || '').toUpperCase().trim(),
          municipio:      String(r['Município'] || r['Municipio'] || r['Cidade'] || '').toUpperCase().trim(),
          previsao:       normDate(r['Previsão'] || r['Previsao'] || r['Entrega Prevista']),
          entrega:        excelToBrDate(r['Entrega'] || r['Data Entregue']) || '',
          dias:           parseInt(r['Dias'] || 0) || 0,
          contato:        r['Contato'] || r['Email'] || '',
          status:         String(r['Status'] || 'EM TRÂNSITO').toUpperCase().trim(),
          obs:            r['Obs'] || r['Observação'] || r['Observacao'] || ''
        };
      });

      filteredData = [...dataSET];
      buildFilterDropdowns();
      executeDataRefresh();

      document.getElementById('import-ok').innerText = `Sucesso! ${dataSET.length} registros importados.`;
      document.getElementById('import-ok').style.display = 'block';
      showToast("Base de dados atualizada com sucesso!");

      setTimeout(() => {
        closeModal();
        document.getElementById('import-ok').style.display = 'none';
        document.getElementById('f-file').value = '';
      }, 1500);

    } catch (err) {
      console.error(err);
      alert("Falha ao interpretar o arquivo. Verifique se as colunas estão corretas.");
    }
  };

  // CSV do Excel brasileiro: sempre Windows-1252 (resolve acentos corrompidos)
  // XLSX lê como binário via SheetJS
  if (isCSV) {
    reader.readAsText(file, 'windows-1252');
  } else {
    reader.readAsArrayBuffer(file);
  }
}

function csvEscape(value) {
  const str = String(value ?? '');
  // Se o valor contém ; " ou quebra de linha, precisa ser envolvido em aspas
  // (senão qualquer observação ou nome de destinatário com ";" quebra as colunas do CSV)
  if (/[;"\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function exportCSV() {
  if(filteredData.length === 0) {
    showToast("Sem dados ativos para exportar.");
    return;
  }

  const headers = [
    '#NF', 'Vendedor', 'Destinatario', 'UF', 'Municipio', 'Transportadora',
    'Emissao', 'ValorNF', 'ValorFrete', 'PercFrete', 'Previsao', 'DataEntregue',
    'Contato', 'Status', 'Obs'
  ];

  const rows = filteredData.map(i => [
    i.id, i.vendedor, i.destinatario, i.uf, i.municipio, i.transportadora,
    i.emissao, i.valorNF, i.valorC, calcPct(i.valorNF, i.valorC), i.previsao, i.entrega,
    i.contato, i.status, i.obs
  ].map(csvEscape).join(';'));

  const csvContent = "\uFEFF" + headers.join(';') + "\n" + rows.join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `fortecare_export_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast(`${filteredData.length} registro(s) exportado(s).`);
}

// Mensagens Toast de feedback flutuante
function showToast(msg) {
  const t = document.getElementById('toast');
  t.innerText = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

function openModal() { document.getElementById('overlay').classList.add('open'); }
function closeModal() { document.getElementById('overlay').classList.remove('open'); }

// ═══════════════════════════════════════════════
// INCLUSÃO MANUAL DE PEDIDO
// ═══════════════════════════════════════════════
function openManualModal() {
  // Preenche data de emissão com hoje por padrão
  const hoje = new Date().toISOString().split('T')[0];
  document.getElementById('m-emissao').value = hoje;
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

function closeManualModal() {
  document.getElementById('manual-overlay').classList.remove('open');
}

function saveManualPedido() {
  const errorEl = document.getElementById('manual-modal-error');
  errorEl.style.display = 'none';

  const nf     = document.getElementById('m-nf').value.trim();
  const vend   = document.getElementById('m-vendedor').value.trim().toUpperCase();
  const dest   = document.getElementById('m-destinatario').value.trim().toUpperCase();
  const uf     = document.getElementById('m-uf').value.trim().toUpperCase();
  const mun    = document.getElementById('m-municipio').value.trim().toUpperCase();
  const transp = document.getElementById('m-transportadora').value.trim().toUpperCase();
  const emis   = document.getElementById('m-emissao').value;
  const prev   = document.getElementById('m-previsao').value;
  const valorNF = parseFloat(document.getElementById('m-valornf').value) || 0;
  const valorC  = parseFloat(document.getElementById('m-valorfrete').value) || 0;
  const status  = document.getElementById('m-status').value;
  const contato = document.getElementById('m-contato').value.trim();
  const obs     = document.getElementById('m-obs').value.trim();

  // Validação dos campos obrigatórios
  if (!nf || !vend || !dest || !uf || !transp || !emis) {
    errorEl.innerText = 'Preencha os campos obrigatórios: NF, Vendedor, Destinatário, UF, Transportadora e Emissão.';
    errorEl.style.display = 'block';
    return;
  }

  const novoPedido = {
    _rowId:         nextRowId++,
    id:             nf,
    vendedor:       vend,
    valorNF,
    valorC,
    pct:            calcPct(valorNF, valorC),
    transportadora: transp,
    emissao:        emis,
    destinatario:   dest,
    uf,
    municipio:      mun,
    previsao:       prev ? isoToBr(prev) : '-',
    entrega:        '',
    dias:           0,
    contato,
    status,
    obs
  };

  dataSET.push(novoPedido);
  filteredData = [...dataSET];
  buildFilterDropdowns();
  executeDataRefresh();

  closeManualModal();
  showToast(`Pedido #${nf} incluído com sucesso!`);

  // Navega para a aba de pedidos para o usuário ver o registro incluído
  showTab('pedidos', document.querySelector('.sb-nav li:nth-child(2)'));
}

// ═══════════════════════════════════════════════
// AUTENTICAÇÃO E GESTÃO DE USUÁRIOS
// ═══════════════════════════════════════════════
// Login é feito em login.html e a sessão é passada via sessionStorage.
// Os usuários ficam salvos no localStorage do computador (solução local).
// Quando o banco de dados entrar, isso será substituído por autenticação via API.
const USERS_KEY = 'fortecare_users';
let currentUser = null;

const TIPOS_USUARIO = ['Administrador','Gerente de Logística', 'Gerente', 'Operador', 'Vendedor'];

function loadUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; } catch { return []; }
}

function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function applyLoggedUser() {
  if (!currentUser) return;

  const initials = currentUser.nome.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('').toUpperCase();
  document.getElementById('user-av').innerText = initials || '?';
  document.getElementById('user-name').innerText = currentUser.nome;
  document.getElementById('user-role').innerText = currentUser.tipo;
  document.getElementById('user-pill').setAttribute('data-tooltip', `${currentUser.nome} — ${currentUser.tipo} (clique para sair)`);

  // Menu "Administração" só aparece para o tipo Administrador
  const adminMenuItem = document.querySelector('.sb-nav li[data-tooltip="Administração"]');
  if (adminMenuItem) {
    adminMenuItem.style.display = currentUser.tipo === 'Administrador' ? 'flex' : 'none';
    // Se um não-administrador estava (por algum motivo) na aba Administração, tira ele de lá
    if (currentUser.tipo !== 'Administrador' && document.getElementById('tab-administracao').classList.contains('active')) {
      showTab('dashboard', document.querySelector('.sb-nav li:nth-child(1)'));
    }
  }

  renderUsersPanel();
}

function logout() {
  if (!currentUser) return;
  if (!confirm('Deseja sair do sistema?')) return;
  currentUser = null;
  try { sessionStorage.removeItem('fortecare_session'); } catch {}
  window.location.replace('login.html');
}

// ── CRUD DE USUÁRIOS (aba Administração) ───────
function renderUsersPanel() {
  const card = document.getElementById('admin-users-card');
  if (!card) return;

  if (!currentUser || currentUser.tipo !== 'Administrador') {
    card.innerHTML = `
      <div class="chart-title" style="margin-bottom:12px">Gestão de Usuários</div>
      <p style="font-size:13px;color:var(--muted)">Acesso restrito a usuários do tipo Administrador.</p>
    `;
    return;
  }

  const users = loadUsers();
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div class="chart-title" style="margin:0">Gestão de Usuários</div>
      <button class="btn btn-primary" style="font-size:12px" onclick="openUserModal()">+ Novo Usuário</button>
    </div>
    <div class="t-scroll">
      <table>
        <thead><tr><th>Nome</th><th>E-mail</th><th>Setor</th><th>Tipo</th><th>Ações</th></tr></thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td>${escapeHtml(u.nome)}</td>
              <td>${escapeHtml(u.email)}</td>
              <td>${escapeHtml(u.setor)}</td>
              <td><span class="badge bT">${escapeHtml(u.tipo)}</span></td>
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
}

function openUserModal(id) {
  const isEdit = !!id;
  document.getElementById('user-modal-title').innerText = isEdit ? 'Editar Usuário' : 'Novo Usuário';
  document.getElementById('user-modal-error').style.display = 'none';
  document.getElementById('u-edit-id').value = id || '';

  if (isEdit) {
    const user = loadUsers().find(u => u.id === id);
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

function closeUserModal() {
  document.getElementById('user-overlay').classList.remove('open');
}

function saveUser() {
  const editId = document.getElementById('u-edit-id').value;
  const nome = document.getElementById('u-nome').value.trim();
  const email = document.getElementById('u-email').value.trim().toLowerCase();
  const senha = document.getElementById('u-senha').value;
  const setor = document.getElementById('u-setor').value.trim();
  const tipo = document.getElementById('u-tipo').value;
  const errorEl = document.getElementById('user-modal-error');

  if (!nome || !email || !setor || !tipo || (!editId && !senha)) {
    errorEl.innerText = 'Preencha todos os campos obrigatórios.';
    errorEl.style.display = 'block';
    return;
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    errorEl.innerText = 'Informe um e-mail válido.';
    errorEl.style.display = 'block';
    return;
  }
  if (senha && senha.length < 6) {
    errorEl.innerText = 'A senha precisa ter ao menos 6 caracteres.';
    errorEl.style.display = 'block';
    return;
  }

  let users = loadUsers();
  const emailTaken = users.some(u => u.email.toLowerCase() === email && String(u.id) !== String(editId));
  if (emailTaken) {
    errorEl.innerText = 'Já existe um usuário com esse e-mail.';
    errorEl.style.display = 'block';
    return;
  }

  if (editId) {
    users = users.map(u => {
      if (String(u.id) !== String(editId)) return u;
      const updated = { ...u, nome, email, setor, tipo, senha: senha ? senha : u.senha };
      if (currentUser && currentUser.id === u.id) currentUser = updated;
      return updated;
    });
  } else {
    const newId = users.length ? Math.max(...users.map(u => u.id)) + 1 : 1;
    users.push({ id: newId, nome, email, senha, setor, tipo });
  }

  saveUsers(users);
  closeUserModal();
  applyLoggedUser();
  showToast('Usuário salvo.');
}

function deleteUser(id) {
  const users = loadUsers();
  const target = users.find(u => u.id === id);
  if (!target) return;

  const admins = users.filter(u => u.tipo === 'Administrador');
  if (target.tipo === 'Administrador' && admins.length <= 1) {
    alert('Não é possível excluir o último usuário Administrador do sistema.');
    return;
  }
  if (currentUser && currentUser.id === id) {
    alert('Você não pode excluir o próprio usuário enquanto estiver logado.');
    return;
  }
  if (!confirm(`Excluir o usuário "${target.nome}"?`)) return;

  saveUsers(users.filter(u => u.id !== id));
  renderUsersPanel();
  showToast('Usuário excluído.');
}