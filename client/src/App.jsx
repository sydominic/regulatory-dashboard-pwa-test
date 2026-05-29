import React, { useEffect, useRef, useState } from 'react';
import {
  ExternalLink,
  RefreshCw,
  Search,
  Database,
  FileText,
  Layers,
  Zap,
  Bell,
  Megaphone,
  ScrollText,
  BookOpen,
  FileCheck,
  ClipboardList,
  Landmark,
  Gavel,
  BookMarked,
  ShieldCheck,
  Newspaper,
  FileCog,
  Filter,
  FolderKanban,
  Building2
} from 'lucide-react';
import './styles.css';

const PERIODS = [
  { value: 'today', label: '오늘' },
  { value: 'recent7', label: '최근 7일' },
  { value: 'recent14', label: '최근 14일' },
  { value: 'custom', label: '직접 선택' }
];

function todayKst() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function numberFmt(n) {
  return Number(n || 0).toLocaleString('ko-KR');
}

async function apiGet(path) {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body || {})
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


function pickDiagnosticSummary(result) {
  const boards = result?.boardResults || [];
  if (!boards.length) return '';
  const meaningful = boards.find(b => (b?.htmlDiag?.bodyLength || b?.rssDiag?.bodyLength || b?.errors?.length)) || boards[0];
  if (!meaningful) return '';
  const h = meaningful.htmlDiag || {};
  const r = meaningful.rssDiag || {};
  const title = h.sampleTitles?.length ? ` / 샘플제목: ${h.sampleTitles.slice(0, 2).join(' | ')}` : '';
  const err = meaningful.errors?.length ? ` / 오류: ${meaningful.errors[0]}` : '';
  return ` / 진단(${meaningful.category || meaningful.board_id}): RSS body ${numberFmt(r.bodyLength)}·item ${numberFmt(r.itemTagCount)}·${r.transport || '-'}, HTML status ${h.status || '-'}·body ${numberFmt(h.bodyLength)}·${h.transport || '-'}·anchor ${numberFmt(h.anchorTotal)}·view ${numberFmt(h.viewLinkCandidates)}·block ${numberFmt(h.textBlockCandidates)}${title}${err}`;
}

function renderJobProgress(job) {
  const p = job?.progress || {};
  const current = job?.current || {};
  const head = job?.status === 'done' ? '수집 완료' : job?.status === 'failed' ? '수집 실패' : '수집 진행 중';
  const currentText = current.category ? ` / 현재: ${current.category}` : '';
  return `${head}${currentText} / RSS ${numberFmt(p.rssChecked)}건, HTML ${numberFmt(p.htmlChecked)}건, 상세검증 ${numberFmt(p.detailChecked)}건, 후보 ${numberFmt(p.candidates || p.checked || p.rows || 0)}건, 신규 ${numberFmt(p.inserted)}건, 중복 ${numberFmt(p.skipped)}건`;
}

function periodDatesForClient(period, startDate, endDate) {
  const today = todayKst();
  if (period === 'today') return { startDate: today, endDate: today };
  if (period === 'recent14') return { startDate: addDays(today, -14), endDate: today };
  if (period === 'custom') return { startDate: startDate || addDays(today, -7), endDate: endDate || today };
  return { startDate: addDays(today, -7), endDate: today };
}

function normalizeFilters(input) {
  const base = input || {};
  const range = periodDatesForClient(base.period || 'recent7', base.startDate, base.endDate);
  return {
    period: base.period || 'recent7',
    startDate: range.startDate,
    endDate: range.endDate,
    q: base.q || ''
  };
}

function emptyPage(pageSize = 10) {
  return { items: [], total: 0, totalPages: 1, page: 1, pageSize };
}

function buildQuery(filters, extra = {}) {
  const normalized = normalizeFilters(filters);
  const params = new URLSearchParams();
  params.set('period', normalized.period);
  // Always send an explicit date range so server date does not drift after long uptime.
  params.set('startDate', normalized.startDate);
  params.set('endDate', normalized.endDate);
  if (normalized.q) params.set('q', normalized.q);
  Object.entries(extra).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    if (k === 'category' && v === '전체') return;
    params.set(k, v);
  });
  return params.toString();
}

function App() {
  const [tab, setTab] = useState('main');
  const [options, setOptions] = useState({ categories: ['전체'], boards: [] });
  const initialFilters = normalizeFilters({ period: 'recent7', startDate: addDays(todayKst(), -7), endDate: todayKst(), q: '' });
  const [filters, setFilters] = useState(initialFilters);
  const [draft, setDraft] = useState(initialFilters);
  const [selectedCategory, setSelectedCategory] = useState('전체');
  const [stats, setStats] = useState(null);
  const [items, setItems] = useState(emptyPage(10));
  const [categoryItems, setCategoryItems] = useState(emptyPage(10));
  const [loading, setLoading] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [collectJob, setCollectJob] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const dataRequestRef = useRef(0);

  async function loadOptions() {
    try {
      const data = await apiGet('/api/options');
      setOptions(data);
    } catch (err) {
      setError(`선택조건 조회 실패: ${err.message}`);
    }
  }

  async function loadData(page = 1, categoryPage = 1, nextFilters = filters, category = selectedCategory) {
    const requestId = dataRequestRef.current + 1;
    dataRequestRef.current = requestId;
    const normalized = normalizeFilters(nextFilters);
    setLoading(true);
    setError('');
    setCategoryItems(emptyPage(10));
    try {
      const [statsData, listData, categoryData] = await Promise.all([
        apiGet(`/api/stats?${buildQuery(normalized)}`),
        apiGet(`/api/items?${buildQuery(normalized, { page, pageSize: 10 })}`),
        apiGet(`/api/items?${buildQuery(normalized, { page: categoryPage, pageSize: 10, category })}`)
      ]);
      if (requestId !== dataRequestRef.current) return;
      setStats(statsData);
      setItems(listData);
      setCategoryItems(categoryData);
    } catch (err) {
      if (requestId === dataRequestRef.current) setError(err.message || String(err));
    } finally {
      if (requestId === dataRequestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    loadOptions();
    loadData(1, 1, filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  function applyFilters() {
    const normalized = normalizeFilters(draft);
    setFilters(normalized);
    setDraft(normalized);
    setMessage('조회조건을 적용했습니다. DB 저장 데이터만 조회합니다.');
    loadData(1, 1, normalized, selectedCategory);
    setMobileFiltersOpen(false);
  }

  async function collect(mode) {
    setCollecting(false);
    setCollectJob(null);
    setError('');
    const label = mode === 'fast' ? '빠른수집' : '기간수집';
    setMessage(`${label}은 Render 서버에서 직접 실행하지 않습니다. 식약처 사이트가 Render에서 timeout 되므로, 선생님 PC의 mfds_collector\\run_collect_mfds.bat 또는 작업 스케줄러로 수집한 뒤 조회 버튼을 눌러 Supabase 저장 데이터를 확인하세요.`);
    await loadData(1, 1, filters);
  }


  const headerStats = stats?.stats || { today: 0, recent7: 0, recent14: 0, total: 0 };
  const periodLabel = PERIODS.find(p => p.value === filters.period)?.label || '최근 7일';
  const filterSummary = `${periodLabel} · 전체${filters.q ? ` · ${filters.q}` : ''}`;

  const filterBody = (
    <>
      <div className="field search-field">
        <label>검색어</label>
        <div className="input-icon"><Search size={16} /><input value={draft.q} onChange={e => setDraft({ ...draft, q: e.target.value })} placeholder="검색어를 입력하세요" /></div>
      </div>
      <div className="field period-field">
        <label>기간</label>
        <select value={draft.period} onChange={e => setDraft({ ...draft, period: e.target.value })}>
          {PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>
      {draft.period === 'custom' && <>
        <div className="field date-field"><label>시작일</label><input type="date" value={draft.startDate} onChange={e => setDraft({ ...draft, startDate: e.target.value })} /></div>
        <div className="field date-field"><label>종료일</label><input type="date" value={draft.endDate} onChange={e => setDraft({ ...draft, endDate: e.target.value })} /></div>
      </>}
      <div className="button-row">
        <button className="btn primary" onClick={applyFilters} disabled={loading}><Search size={16} />조회</button>
        <button className="btn collect" onClick={() => collect('fast')} disabled={collecting}><Zap size={16} />빠른수집</button>
        <button className="btn collect-dark" onClick={() => collect('period')} disabled={collecting}><RefreshCw size={16} />기간수집</button>
      </div>
    </>
  );

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <div className="kicker"><span className="kicker-mark" /> MFDS MONITORING</div>
          <h1>Regulatory Update Dashboard</h1>
          <p>식약처 게시물을 자동 수집·누적 DB로 관리하고, 전체 정보와 구분별 정보를 한 화면에서 빠르게 확인합니다.</p>
          <div className="hero-meta">
            <span><i className="dot dot-blue" /> MFDS</span>
            <span><i className="dot dot-green" /> {stats?.totalStored !== undefined ? 'DB 연결됨' : 'DB 확인 중'}</span>
            <span><i className="dot dot-amber" /> 마지막 수집: {stats?.lastCollected || '-'}</span>
          </div>
        </div>
      </header>

      {tab === 'main' && <section className="mobile-filter-wrap card mobile-only">
        <button className="mobile-filter-toggle" onClick={() => setMobileFiltersOpen(v => !v)}>
          <span><Filter size={16} /> 조회조건 <small>{filterSummary}</small></span>
          <strong>{mobileFiltersOpen ? '접기' : '열기'}</strong>
        </button>
        <div className={`mobile-filter-body ${mobileFiltersOpen ? 'open' : ''}`}>
          <div className={`toolbar mobile-toolbar ${draft.period === 'custom' ? 'custom-period' : ''}`}>
            {filterBody}
          </div>
        </div>
      </section>}

      <section className={`toolbar card desktop-only ${draft.period === 'custom' ? 'custom-period' : ''}`}>
        {filterBody}
      </section>

      {message && <div className="notice ok">{message}</div>}
      {error && <div className="notice error">{error}</div>}
      {loading && <div className="notice info">데이터를 조회하는 중입니다.</div>}
      {collecting && collectJob?.status !== 'done' && <div className="notice info">{collectJob ? renderJobProgress(collectJob) : '식약처 게시판 수집 작업을 시작하는 중입니다.'}</div>}

      <section className="stat-grid desktop-only">
        <Metric title="오늘 신규" value={headerStats.today} sub="오늘 게시 기준" icon={<FileText size={19} />} />
        <Metric title="최근 7일" value={headerStats.recent7} sub="최근 7일 게시 기준" icon={<Database size={19} />} />
        <Metric title="최근 14일" value={headerStats.recent14} sub="최근 14일 게시 기준" icon={<Layers size={19} />} />
        <Metric title="전체 저장" value={headerStats.total} sub="DB 누적 전체" icon={<Database size={19} />} />
      </section>

      {tab === 'main' && <section className="stat-grid mobile-only">
        <Metric title="오늘 신규" value={headerStats.today} sub="오늘 게시 기준" icon={<FileText size={19} />} />
        <Metric title="최근 7일" value={headerStats.recent7} sub="최근 7일 게시 기준" icon={<Database size={19} />} />
        <Metric title="최근 14일" value={headerStats.recent14} sub="최근 14일 게시 기준" icon={<Layers size={19} />} />
        <Metric title="전체 저장" value={headerStats.total} sub="DB 누적 전체" icon={<Database size={19} />} />
      </section>}

      <nav className="tabs desktop-only">
        <button className={tab === 'main' ? 'active' : ''} onClick={() => setTab('main')}>식약처 정보</button>
        <button className={tab === 'category' ? 'active' : ''} onClick={() => setTab('category')}>구분별 정보</button>
        <button className={tab === 'boards' ? 'active' : ''} onClick={() => setTab('boards')}>공식 게시판</button>
      </nav>

      {tab === 'main' && <>
        <section className="single-col">
          <div className="card panel latest-panel">
            <h2>최신 게시물</h2>
            <RecentList items={stats?.recent || []} />
          </div>
        </section>
        <ItemTable title="식약처 상세 목록" data={items} onPage={p => loadData(p, categoryItems.page, filters, selectedCategory)} />
      </>}

      {tab === 'category' && <>
        <div className="category-select-wrap mobile-only card">
          <label>구분 선택</label>
          <select value={selectedCategory} onChange={e => {
            const c = e.target.value;
            setSelectedCategory(c);
            loadData(1, 1, filters, c);
          }}>
            {options.categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="category-chip-row desktop-only">
          {options.categories.map(c => <button key={c} className={selectedCategory === c ? 'chip active' : 'chip'} onClick={() => { setSelectedCategory(c); loadData(1, 1, filters, c); }}>{c}</button>)}
        </div>
        <ItemTable title={`${selectedCategory || '전체'} 정보`} data={categoryItems} onPage={p => loadData(items.page, p, filters, selectedCategory)} />
      </>}

      {tab === 'boards' && <OfficialBoards boards={options.boards} />}

      <nav className="bottom-tabs mobile-only">
        <button className={tab === 'main' ? 'active' : ''} onClick={() => setTab('main')}>
          <FileText size={18} />
          <span>식약처 정보</span>
        </button>
        <button className={tab === 'category' ? 'active' : ''} onClick={() => setTab('category')}>
          <FolderKanban size={18} />
          <span>구분별 정보</span>
        </button>
        <button className={tab === 'boards' ? 'active' : ''} onClick={() => setTab('boards')}>
          <Building2 size={18} />
          <span>공식 게시판</span>
        </button>
      </nav>
    </div>
  );
}

function Metric({ title, value, sub, icon }) {
  return <div className="metric card"><div className="metric-icon">{icon}</div><div><p>{title}</p><strong>{numberFmt(value)}건</strong><span>{sub}</span></div></div>;
}

function RecentList({ items }) {
  if (!items?.length) return <p className="empty-text">선택한 조건에 최신 게시물이 없습니다.</p>;
  return <ul className="recent-list">{items.map((item, idx) => <li key={`${item.item_key || item.url || idx}`}><span>{item.item_date}</span><a href={item.url} target="_blank" rel="noreferrer">{item.title}<ExternalLink size={13} /></a><em>{item.category}</em></li>)}</ul>;
}

function ItemTable({ title, data, onPage }) {
  const items = data?.items || [];
  return <section className="card table-card">
    <div className="table-head"><h2>{title}</h2><span>{numberFmt(data?.total || 0)}건 · {data?.page || 1}/{data?.totalPages || 1}페이지</span></div>
    <div className="table-wrap"><table><thead><tr><th>게시일</th><th>구분</th><th>제목</th><th>링크</th></tr></thead><tbody>{items.length ? items.map((item, idx) => <tr key={`${item.item_key || item.url || idx}`}><td className="date-cell">{item.item_date}</td><td><span className="badge">{item.category}</span></td><td className="title-cell">{item.title}</td><td><a className="open-link" href={item.url} target="_blank" rel="noreferrer">열기<ExternalLink size={13} /></a></td></tr>) : <tr><td colSpan="4" className="empty-cell">표시할 항목이 없습니다.</td></tr>}</tbody></table></div>
    <div className="pagination"><button disabled={(data?.page || 1) <= 1} onClick={() => onPage((data?.page || 1) - 1)}>‹ 이전</button><span>{data?.page || 1} / {data?.totalPages || 1}</span><button disabled={(data?.page || 1) >= (data?.totalPages || 1)} onClick={() => onPage((data?.page || 1) + 1)}>다음 ›</button></div>
  </section>;
}

const boardIconMap = {
  '공지': Bell,
  '공고': Megaphone,
  '보도자료': Newspaper,
  '법, 시행령, 시행규칙': Landmark,
  '고시전문': ScrollText,
  '훈령전문': FileCog,
  '예규전문': BookMarked,
  '제개정고시등': Gavel,
  '입법/행정예고': ClipboardList,
  '공무원지침서': FileCheck,
  '민원인안내서': BookOpen,
  '안내서/지침': ShieldCheck,
  '학술토론회': Layers,
  '전문홍보물': FileText
};

function OfficialBoards({ boards }) {
  if (!boards?.length) return <p className="empty-text">게시판 정보가 없습니다.</p>;
  return <section className="board-grid">{boards.map(b => {
    const Icon = boardIconMap[b.category] || FileText;
    return <a className="board-card card" key={b.board_id} href={b.url} target="_blank" rel="noreferrer">
      <div className="board-icon"><Icon size={22} /></div>
      <strong>{b.category}</strong>
      <ExternalLink className="board-open-icon" size={15} />
    </a>;
  })}</section>;
}

export default App;
