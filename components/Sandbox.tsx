'use client';

import { useEffect, useMemo, useState } from 'react';
import { avatarURL } from '@/lib/avatars';
import {
  PRODUCTS,
  SEARCH_PRODUCTS,
  EXPERIENCE_PRODUCTS,
  defaultProduct,
} from '@/lib/products';
import { dominantValue } from '@/lib/personas';
import {
  makeInstances,
  avatarPersona,
  generatePopulationAgents,
  type PersonaInstance,
} from '@/lib/instances';
import type {
  Persona,
  ActiveProduct,
  CustomProduct,
  SimulateRequest,
  SimulateResponse,
  GoodType,
} from '@/lib/types';

type LoaderStep = 'stage1' | 'discussion' | 'stage2' | 'metrics' | 'done';
type SimMode = 'saved' | 'live';

interface SavedResultMeta {
  id: string;
  label: string;
  file: string;
  product?: string;
  deltaPct?: number;
  n?: number;
}

function fmtKRW(n: number) {
  return n.toLocaleString('ko-KR') + '원';
}

function fmtPct(n: number, digits = 0) {
  return (n * 100).toFixed(digits) + '%';
}

function fmtSigned(n: number, digits = 1) {
  return (n >= 0 ? '+' : '') + n.toFixed(digits);
}

interface SandboxProps {
  personas: Persona[];
}

interface CustomFormState {
  enabled: boolean;
  name: string;
  basePrice: string; // string for input handling
  goodType: GoodType;
}

const DEFAULT_CUSTOM: CustomFormState = {
  enabled: false,
  name: '',
  basePrice: '',
  goodType: 'search',
};

export default function Sandbox({ personas }: SandboxProps) {
  const [selectedProductId, setSelectedProductId] = useState<string>(
    defaultProduct().id,
  );
  const [custom, setCustom] = useState<CustomFormState>(DEFAULT_CUSTOM);
  const [deltaPct, setDeltaPct] = useState<number>(20);
  const [discussion, setDiscussion] = useState<boolean>(true);
  const [popPerArch, setPopPerArch] = useState<number>(10); // N=160 default
  // Safe derived population multiplier — guards against NaN if state ever becomes corrupt.
  const safePopPerArch =
    Number.isFinite(popPerArch) && popPerArch > 0 ? popPerArch : 20;
  const totalPopulation = safePopPerArch * 16;
  const [mode, setMode] = useState<SimMode>('saved');
  const [savedIndex, setSavedIndex] = useState<SavedResultMeta[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedNFilter, setSavedNFilter] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [loaderStep, setLoaderStep] = useState<LoaderStep>('stage1');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SimulateResponse | null>(null);
  const [selectedArchetype, setSelectedArchetype] = useState<Persona | null>(
    null,
  );

  useEffect(() => {
    fetch('/saved-results/index.json')
      .then((r) => (r.ok ? r.json() : []))
      .then(setSavedIndex)
      .catch(() => setSavedIndex([]));
  }, []);

  async function loadSavedResult(meta: SavedResultMeta) {
    setSavedLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch(`/saved-results/${meta.file}`);
      if (!r.ok) throw new Error('파일을 불러오지 못했습니다.');
      const data = await r.json() as SimulateResponse;
      setResult(data);
      // sync N selector so population stats reflect this result
      if (data.populationSize) {
        setPopPerArch(Math.max(1, Math.round(data.populationSize / 16)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavedLoading(false);
    }
  }

  function downloadResult() {
    if (!result) return;
    const id = `${result.product.id}_d${result.deltaPct}_${result.discussion ? 'disc' : 'nodisc'}_n${result.populationSize}`;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const expectedPopulation = useMemo(() => {
    return generatePopulationAgents(totalPopulation, personas);
  }, [totalPopulation, personas]);

  const popStats = useMemo(() => {
    const total = expectedPopulation.length || 1;
    const maleC = expectedPopulation.filter((a) => a.sex === 'M').length;
    const genZ = expectedPopulation.filter((a) => a.gen === 'Z').length;
    const genM = expectedPopulation.filter((a) => a.gen === 'M').length;
    const genX = expectedPopulation.filter((a) => a.gen === 'X').length;
    const genB = expectedPopulation.filter((a) => a.gen === 'Boomer').length;

    let sumInc = 0;
    let sumBud = 0;
    let sumSavings = 0;
    let sumMonitor = 0;
    let sumCosmetics = 0;

    const incDist = { low: 0, mid: 0, high: 0 };
    const valDist = { gaseong: 0, gasim: 0, meaning: 0, brand: 0 };
    const houseDist = { single: 0, parents: 0, dink: 0, family: 0, senior: 0 };

    expectedPopulation.forEach((a) => {
      sumInc += a.income;
      sumBud += a.budget_limit_krw || Math.round(a.income * 0.1);
      sumSavings += a.savings_rate * 100;
      sumMonitor += a.lifestyle?.monitor_interest || 0;
      sumCosmetics += a.lifestyle?.cosmetics_interest || 0;

      const i = a.income / 10000;
      if (i < 300) incDist.low++;
      else if (i <= 500) incDist.mid++;
      else incDist.high++;

      const v = a.values;
      const maxV = Math.max(v.gaseong, v.gasim, v.meaning, v.brand);
      if (maxV === v.gaseong) valDist.gaseong++;
      else if (maxV === v.gasim) valDist.gasim++;
      else if (maxV === v.meaning) valDist.meaning++;
      else valDist.brand++;

      if (a.householdCode === 'single') houseDist.single++;
      else if (a.householdCode === 'parents') houseDist.parents++;
      else if (a.householdCode === 'dink') houseDist.dink++;
      else if (a.householdCode === 'family') houseDist.family++;
      else houseDist.senior++;
    });

    return {
      male: Math.round((maleC / total) * 100),
      female: 100 - Math.round((maleC / total) * 100),
      z: Math.round((genZ / total) * 100),
      m: Math.round((genM / total) * 100),
      x: Math.round((genX / total) * 100),
      b: Math.round((genB / total) * 100),
      inc: Math.round(sumInc / total / 10000),
      bud: Math.round(sumBud / total / 10000),
      avgSavings: Math.round(sumSavings / total),
      avgMonitor: Math.round((sumMonitor / total) * 100),
      avgCosmetics: Math.round((sumCosmetics / total) * 100),
      incDist: {
        low: Math.round((incDist.low / total) * 100),
        mid: Math.round((incDist.mid / total) * 100),
        high: Math.round((incDist.high / total) * 100),
      },
      valDist: {
        gaseong: Math.round((valDist.gaseong / total) * 100),
        gasim: Math.round((valDist.gasim / total) * 100),
        meaning: Math.round((valDist.meaning / total) * 100),
        brand: Math.round((valDist.brand / total) * 100),
      },
      houseDist: {
        single: Math.round((houseDist.single / total) * 100),
        parents: Math.round((houseDist.parents / total) * 100),
        dink: Math.round((houseDist.dink / total) * 100),
        family: Math.round((houseDist.family / total) * 100),
        senior: Math.round((houseDist.senior / total) * 100),
      },
    };
  }, [expectedPopulation]);

  const instances = useMemo(() => makeInstances(personas), [personas]);

  const activeProduct = useMemo<ActiveProduct | null>(() => {
    if (custom.enabled) {
      const price = parseInt(custom.basePrice, 10);
      if (!custom.name.trim() || !price || price <= 0) return null;
      const p: CustomProduct = {
        id: 'custom',
        name: custom.name.trim(),
        emoji: custom.goodType === 'search' ? '🔍' : '✨',
        goodType: custom.goodType,
        basePrice: price,
        unit: '개',
        priceSource: '사용자 입력',
        elasticityPrior: '사용자 정의',
      };
      return p;
    }
    return PRODUCTS.find((p) => p.id === selectedProductId) ?? defaultProduct();
  }, [custom, selectedProductId]);

  const runDisabled = !activeProduct || loading;

  async function runSimulation() {
    if (!activeProduct) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setLoaderStep('stage1');

    // Cosmetic stepping: rotates label while the single network call runs
    let cancel = false;
    const ticker = (async () => {
      const steps: LoaderStep[] = ['stage1', 'discussion', 'stage2', 'metrics'];
      for (const s of steps) {
        if (cancel) return;
        if (s === 'discussion' && !discussion) continue;
        if (s === 'stage2' && !discussion) continue;
        setLoaderStep(s);
        await new Promise((r) => setTimeout(r, 5000));
      }
    })();

    const controller = new AbortController();
    // Vercel serverless cap is 60s; abort slightly before so we surface our own friendly message.
    const timeoutId = setTimeout(() => controller.abort(), 240_000);

    try {
      const body: SimulateRequest = {
        product: activeProduct,
        deltaPct,
        discussion,
        populationSize: totalPopulation,
      };
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error ?? `요청 실패 (${res.status})`);
      }
      cancel = true;
      void ticker;
      setLoaderStep('done');
      setResult(json as SimulateResponse);
    } catch (e) {
      cancel = true;
      void ticker;
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      setError(
        isAbort
          ? '시뮬레이션이 시간 초과되었습니다. 인구 규모를 줄이거나 잠시 후 다시 시도해 주세요.'
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  return (
    <>
      <header className="app-header">
        <div className="kicker">KAIST IMMS · LIVE PRICING SANDBOX</div>
        <h1 className="app-title">
          호모 실리쿠스 · 페르소나 시뮬레이션 샌드박스
        </h1>
        <p className="app-subtitle">
          GPT-4o-mini 기반 N명의 한국 소비자 에이전트가 가격 인상에 대해 실시간으로
          추론합니다. 탐색재(Search) vs 경험재(Experience) 가격 탄력성과 토론 후
          행동 변화(WOM_m)를 측정.
        </p>
      </header>

      <main>
        <div className="hero-banner">
          <h2>가격 시뮬레이션 샌드박스</h2>
          <p>
            저장된 결과를 즉시 확인하거나, 라이브 시뮬레이션으로 새 결과를 생성하세요.
            라이브 모드는 N명의 개별 에이전트를 OpenAI에 실시간 호출합니다.
          </p>
        </div>

        {/* ── Mode toggle ── */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line)', width: 'fit-content' }}>
          {(['saved', 'live'] as SimMode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(null); setResult(null); }}
              style={{
                padding: '9px 24px', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
                background: mode === m ? 'var(--navy)' : 'var(--paper-2)',
                color: mode === m ? '#fff' : 'var(--ink-soft)',
                transition: 'background 0.15s',
              }}
            >
              {m === 'saved' ? '📁 저장된 결과' : '⚡ 라이브 시뮬레이션'}
            </button>
          ))}
        </div>

        {/* ── Saved results panel ── */}
        {mode === 'saved' && (() => {
          const nOptions = [...new Set(savedIndex.map(m => m.n).filter((n): n is number => typeof n === 'number'))].sort((a, b) => a - b);
          // null = 전체, otherwise filter by N
          const activeN = savedNFilter;
          const filtered = activeN === null ? savedIndex : savedIndex.filter(m => m.n === activeN);
          return (
            <section className="console" style={{ display: 'block', padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: 15 }}>저장된 시뮬레이션 결과</h3>
              {nOptions.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button onClick={() => setSavedNFilter(null)} style={{ padding: '3px 12px', fontSize: 11, fontWeight: 600, borderRadius: 20, cursor: 'pointer', border: '1px solid var(--line)', background: 'var(--navy)', color: '#fff' }}>
                      전체
                    </button>
                  </div>
                )}
              </div>

              {savedIndex.length === 0 ? (
                <div style={{ color: 'var(--ink-mute)', fontSize: 13, lineHeight: 1.9, padding: '12px 0' }}>
                  <p style={{ margin: '0 0 6px' }}>아직 저장된 결과가 없습니다.</p>
                  <p style={{ margin: 0, fontSize: 11 }}>
                    <strong>⚡ 라이브 시뮬레이션</strong> 실행 → <strong>💾 결과 저장</strong>으로 JSON 다운로드 →{' '}
                    <code style={{ background: 'var(--paper-2)', padding: '1px 5px', borderRadius: 3 }}>public/saved-results/</code> 에 파일 추가 →{' '}
                    <code style={{ background: 'var(--paper-2)', padding: '1px 5px', borderRadius: 3 }}>index.json</code> 항목 등록
                  </p>
                </div>
              ) : filtered.length === 0 ? (
                <div style={{ color: 'var(--ink-mute)', fontSize: 13 }}>
                  N = {activeN}에 해당하는 저장된 결과가 없습니다.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                  {filtered.map((meta) => (
                    <button key={meta.id} onClick={() => loadSavedResult(meta)} disabled={savedLoading}
                      style={{
                        background: 'var(--paper-2)', border: '1px solid var(--line)', borderRadius: 8,
                        padding: '16px', textAlign: 'left', cursor: 'pointer', opacity: savedLoading ? 0.6 : 1,
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--navy)', marginBottom: 6 }}>{meta.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-mute)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {meta.product && <span>{meta.product}</span>}
                        {meta.deltaPct !== undefined && <span>+{meta.deltaPct}%</span>}
                        {meta.n !== undefined && <span>N = {meta.n.toLocaleString()}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {savedLoading && <div style={{ marginTop: 14, color: 'var(--ink-mute)', fontSize: 13 }}>⏳ 불러오는 중...</div>}
              {error && <div className="error-banner" style={{ marginTop: 12 }}>⚠ {error}</div>}
            </section>
          );
        })()}

        {/* ── Live Console ── */}
        {mode === 'live' && <section className="console">
          {/* Left: products */}
          <div className="panel">
            <h3>
              <span className="step">1</span> 제품 선택
            </h3>

            <div className="product-group-label">탐색재 · Search Goods</div>
            <div className="product-grid">
              {SEARCH_PRODUCTS.map((p) => (
                <button
                  key={p.id}
                  className={`product-chip${!custom.enabled && selectedProductId === p.id ? ' active' : ''}`}
                  onClick={() => {
                    setSelectedProductId(p.id);
                    setCustom({ ...custom, enabled: false });
                  }}
                >
                  <span className="product-chip-emoji">{p.emoji}</span>
                  <span className="product-chip-meta">
                    <span className="product-chip-name">{p.name}</span>
                    <span className="product-chip-price">
                      {fmtKRW(p.basePrice)}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            <div className="product-group-label">경험재 · Experience Goods</div>
            <div className="product-grid">
              {EXPERIENCE_PRODUCTS.map((p) => (
                <button
                  key={p.id}
                  className={`product-chip experience${!custom.enabled && selectedProductId === p.id ? ' active' : ''}`}
                  onClick={() => {
                    setSelectedProductId(p.id);
                    setCustom({ ...custom, enabled: false });
                  }}
                >
                  <span className="product-chip-emoji">{p.emoji}</span>
                  <span className="product-chip-meta">
                    <span className="product-chip-name">{p.name}</span>
                    <span className="product-chip-price">
                      {fmtKRW(p.basePrice)}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            <button
              className={`custom-toggle${custom.enabled ? ' active' : ''}`}
              onClick={() => setCustom((c) => ({ ...c, enabled: !c.enabled }))}
            >
              {custom.enabled
                ? '✓ 직접 입력 중'
                : '+ 직접 입력 (Custom Product)'}
            </button>

            {custom.enabled && (
              <div className="custom-form">
                <div>
                  <label>제품명</label>
                  <input
                    type="text"
                    value={custom.name}
                    onChange={(e) =>
                      setCustom((c) => ({ ...c, name: e.target.value }))
                    }
                    placeholder="예: 골프채 세트"
                  />
                </div>
                <div className="row">
                  <div>
                    <label>가격 (원)</label>
                    <input
                      type="number"
                      value={custom.basePrice}
                      onChange={(e) =>
                        setCustom((c) => ({ ...c, basePrice: e.target.value }))
                      }
                      placeholder="500000"
                    />
                  </div>
                  <div>
                    <label>재화 분류</label>
                    <div className="good-type-toggle">
                      <button
                        className={custom.goodType === 'search' ? 'active' : ''}
                        onClick={() =>
                          setCustom((c) => ({ ...c, goodType: 'search' }))
                        }
                      >
                        탐색재
                      </button>
                      <button
                        className={
                          custom.goodType === 'experience' ? 'active' : ''
                        }
                        onClick={() =>
                          setCustom((c) => ({ ...c, goodType: 'experience' }))
                        }
                      >
                        경험재
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right: controls + run */}
          <div className="panel">
            <h3>
              <span className="step">2</span> 가격 변동 & 시나리오
            </h3>

            <div className="slider-block">
              <div className="slider-row">
                <span className="slider-label">가격 변동률</span>
                <span className="slider-value">
                  {deltaPct >= 0 ? '+' : ''}
                  {deltaPct}%
                </span>
              </div>
              <input
                type="range"
                min={-20}
                max={50}
                step={5}
                value={deltaPct}
                onChange={(e) => setDeltaPct(parseInt(e.target.value, 10))}
              />
              <div
                style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 6 }}
              >
                기본값 +20% (한국 CPI 평균 인상률의 약 6배, 검출력 확보 수준)
              </div>
            </div>

            {activeProduct && (
              <div
                style={{
                  marginTop: 16,
                  padding: 12,
                  background: 'var(--paper-2)',
                  borderRadius: 6,
                  fontSize: 12,
                }}
              >
                <strong>
                  {activeProduct.emoji} {activeProduct.name}
                </strong>{' '}
                <span style={{ color: 'var(--ink-mute)' }}>
                  {fmtKRW(activeProduct.basePrice)} →{' '}
                  {fmtKRW(
                    Math.round(activeProduct.basePrice * (1 + deltaPct / 100)),
                  )}
                </span>
                <div
                  style={{
                    marginTop: 4,
                    fontFamily: 'var(--font-ibm-plex-mono), monospace',
                    fontSize: 10,
                    color: 'var(--gold-deep)',
                  }}
                >
                  {activeProduct.goodType === 'search' ? '탐색재' : '경험재'} ·{' '}
                  {activeProduct.elasticityPrior}
                </div>
              </div>
            )}

            <div className="discussion-row">
              <input
                type="checkbox"
                id="discussion-toggle"
                checked={discussion}
                onChange={(e) => setDiscussion(e.target.checked)}
              />
              <label htmlFor="discussion-toggle">
                커뮤니티 토론 단계 포함 (오피니언 리더 → 댓글 → 2차 의사결정)
              </label>
            </div>

            <div className="popselect">
              <span>시뮬레이션 인구:</span>
              <select
                value={String(popPerArch)}
                onChange={(e) => setPopPerArch(Number(e.target.value) || 10)}
              >
                <option value="1">N = 16명</option>
                <option value="10">N = 160명 (기본값)</option>
                <option value="20">N = 320명</option>
                <option value="32">N = 512명</option>
              </select>
            </div>

            <button
              className="btn-run"
              disabled={runDisabled}
              onClick={runSimulation}
            >
              {loading ? '시뮬레이션 중...' : '시뮬레이션 실행 →'}
            </button>

            {error && <div className="error-banner">⚠ {error}</div>}
          </div>
        </section>}

        {/* ── Loader ── */}
        {loading && (
          <div className="loader-card">
            <div className="loader-spinner"></div>
            <div
              style={{
                fontFamily: 'var(--font-noto-sans-kr)',
                fontSize: 16,
                color: 'var(--ink)',
              }}
            >
              {loaderStep === 'stage1' &&
                '1차 의사결정 진행 중... (각 페르소나 × 2 가격조건)'}
              {loaderStep === 'discussion' &&
                '커뮤니티 토론 생성 중... (오피니언 리더 + 댓글)'}
              {loaderStep === 'stage2' &&
                '2차 의사결정 재평가 중... (토론 후 영향)'}
              {loaderStep === 'metrics' && '탄력성·WOM·McNemar 산출 중...'}
            </div>
            <div className="loader-steps">
              <span
                className={`loader-step ${loaderStep === 'stage1' ? 'active' : 'done'}`}
              >
                STAGE 1
              </span>
              {discussion && (
                <>
                  <span
                    className={`loader-step ${loaderStep === 'discussion' ? 'active' : loaderStep === 'stage1' ? '' : 'done'}`}
                  >
                    DISCUSSION
                  </span>
                  <span
                    className={`loader-step ${loaderStep === 'stage2' ? 'active' : loaderStep === 'stage1' || loaderStep === 'discussion' ? '' : 'done'}`}
                  >
                    STAGE 2
                  </span>
                </>
              )}
              <span
                className={`loader-step ${loaderStep === 'metrics' ? 'active' : ''}`}
              >
                METRICS
              </span>
            </div>
          </div>
        )}

        {/* ── Results ── */}
        {result && (
          <>
            <ResultsView result={result} personas={personas} />
            {mode === 'live' && (
              <div style={{ textAlign: 'center', margin: '8px 0 24px' }}>
                <button
                  onClick={downloadResult}
                  style={{
                    background: 'var(--paper-2)', border: '1px solid var(--line)',
                    borderRadius: 6, padding: '8px 20px', fontSize: 12,
                    cursor: 'pointer', color: 'var(--ink-soft)',
                  }}
                >
                  💾 결과 저장 (JSON 다운로드 → public/saved-results/ 에 추가)
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Persona library ── */}
        <section className="persona-section">
          <h2 className="section-title">
            페르소나 라이브러리 — 16개 아키타입 / 시뮬레이션 모집단{' '}
            {totalPopulation.toLocaleString()}명
          </h2>
          <p className="section-sub">
            KOSTAT·BOK·KB 보고서 기반 4축 (세대 × 가구 × 경제력 × 가치관) 16개 아키타입.
            시뮬레이션 실행 시 각 아키타입을 기반으로 N명의 개별 에이전트를 생성합니다
            (소득 ±20%, 가치관 ±15%, 나이 세대 범위 내 랜덤, 트라우마·긴급도·탐색체력 독립 샘플링).
            카드를 클릭하면 아키타입 상세가 열립니다.
          </p>

          {/* ── Population Statistics ── */}
          <div style={{ marginBottom: 28 }}>
            {/* Summary chips */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 18 }}>
              {([
                ['모집단', `${totalPopulation.toLocaleString()}명`],
                ['평균 월 소득', `${popStats.inc}만원`],
                ['평균 예산 상한', `${popStats.bud}만원`],
                ['평균 저축률', `${popStats.avgSavings}%`],
                ['탐색재 관심', `${popStats.avgMonitor}/100`],
                ['경험재 관심', `${popStats.avgCosmetics}/100`],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} style={{ background: 'var(--paper-2)', padding: '8px 12px', borderRadius: 6, fontSize: 12 }}>
                  <div style={{ color: 'var(--ink-mute)', fontSize: 10, marginBottom: 2 }}>{k}</div>
                  <div style={{ fontFamily: 'var(--font-ibm-plex-mono), monospace', fontWeight: 700, color: 'var(--navy)' }}>{v}</div>
                </div>
              ))}
            </div>

            {/* Charts grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>

              {/* Gender donut */}
              <div className="detail-block">
                <h4>성별</h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <MiniDonut slices={[{ pct: popStats.male, color: '#1e2761' }, { pct: popStats.female, color: '#c9a961' }]} />
                  <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                    {([['남', popStats.male, '#1e2761'], ['여', popStats.female, '#c9a961']] as [string, number, string][]).map(([l, v, c]) => (
                      <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: c, flexShrink: 0, display: 'inline-block' }} />
                        <span>{l} <strong>{v}%</strong></span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Generation donut */}
              <div className="detail-block">
                <h4>세대</h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <MiniDonut slices={[
                    { pct: popStats.z, color: '#1e2761' },
                    { pct: popStats.m, color: '#c9a961' },
                    { pct: popStats.x, color: '#2d7d6c' },
                    { pct: popStats.b, color: '#7a5230' },
                  ]} />
                  <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                    {([['Z', popStats.z, '#1e2761'], ['밀레니얼', popStats.m, '#c9a961'], ['X', popStats.x, '#2d7d6c'], ['Boomer', popStats.b, '#7a5230']] as [string, number, string][]).map(([l, v, c]) => (
                      <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: c, flexShrink: 0, display: 'inline-block' }} />
                        <span>{l} <strong>{v}%</strong></span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Values donut */}
              <div className="detail-block gold">
                <h4>우세 가치관</h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <MiniDonut slices={[
                    { pct: popStats.valDist.gaseong, color: '#1e2761' },
                    { pct: popStats.valDist.gasim, color: '#c9a961' },
                    { pct: popStats.valDist.meaning, color: '#2d7d6c' },
                    { pct: popStats.valDist.brand, color: '#7a5230' },
                  ]} />
                  <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                    {([['가성비', popStats.valDist.gaseong, '#1e2761'], ['가심비', popStats.valDist.gasim, '#c9a961'], ['미닝아웃', popStats.valDist.meaning, '#2d7d6c'], ['브랜드', popStats.valDist.brand, '#7a5230']] as [string, number, string][]).map(([l, v, c]) => (
                      <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: c, flexShrink: 0, display: 'inline-block' }} />
                        <span>{l} <strong>{v}%</strong></span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Income bars */}
              <div className="detail-block red">
                <h4>소득 구간</h4>
                {([['저 (&lt;300만)', popStats.incDist.low, '#e85d3a'], ['중 (300~500)', popStats.incDist.mid, '#c9a961'], ['고 (&gt;500만)', popStats.incDist.high, '#2d7d6c']] as [string, number, string][]).map(([label, val, color]) => (
                  <div className="value-bar" key={label}>
                    <span className="value-bar-label" style={{ fontSize: 10 }} dangerouslySetInnerHTML={{ __html: label }} />
                    <span className="value-bar-track"><span className="value-bar-fill" style={{ width: `${val}%`, background: color }} /></span>
                    <span className="value-bar-pct">{val}%</span>
                  </div>
                ))}
              </div>

              {/* Household bars */}
              <div className="detail-block green">
                <h4>가구 유형</h4>
                {([['1인가구', popStats.houseDist.single], ['부모동거', popStats.houseDist.parents], ['딩크', popStats.houseDist.dink], ['자녀가족', popStats.houseDist.family], ['시니어', popStats.houseDist.senior]] as [string, number][]).map(([label, val]) => (
                  <div className="value-bar" key={label}>
                    <span className="value-bar-label" style={{ fontSize: 10 }}>{label}</span>
                    <span className="value-bar-track"><span className="value-bar-fill" style={{ width: `${val}%` }} /></span>
                    <span className="value-bar-pct">{val}%</span>
                  </div>
                ))}
              </div>

            </div>
          </div>

          <div className="persona-grid">
            {instances.map((inst) => {
              const p = inst.archetype;
              return (
                <button
                  key={`${p.id}-${inst.instanceIndex}`}
                  className="persona-card persona-card-button"
                  onClick={() => setSelectedArchetype(p)}
                  aria-label={`${p.name} 상세 보기`}
                >
                  <div className="avatar">
                    <img
                      src={avatarURL(avatarPersona(inst))}
                      alt={`${p.name} 아바타`}
                    />
                  </div>
                  <div className="persona-name">
                    {p.name}{' '}
                    <span
                      style={{
                        fontWeight: 400,
                        color: 'var(--ink-mute)',
                        fontSize: 12,
                      }}
                    >
                      · {p.age}
                    </span>
                  </div>
                  <div className="persona-archetype">{p.archetype}</div>
                  <div className="persona-meta">
                    {p.gen}세대 · {p.sex === 'M' ? '남' : '여'}
                    <br />월{' '}
                    {Math.round(inst.jitteredIncome / 10000).toLocaleString()}
                    만원
                  </div>
                  <div className="persona-value-tag">{dominantValue(p)}</div>
                </button>
              );
            })}

            {/* Ghost cards — visually suggest more personas exist beyond the displayed 16 */}
            <div
              className="persona-card persona-card-ghost ghost-1"
              aria-hidden="true"
            >
              <div className="ghost-dots">···</div>
            </div>
            <div
              className="persona-card persona-card-ghost ghost-2"
              aria-hidden="true"
            >
              <div className="ghost-dots">···</div>
            </div>
            <div
              className="persona-card persona-card-ghost ghost-3"
              aria-hidden="true"
            >
              <div className="ghost-more">
                + {Math.max(0, totalPopulation - 16).toLocaleString()}명
              </div>
            </div>
          </div>
        </section>

        {/* ── Archetype detail modal ── */}
        {selectedArchetype && (
          <ArchetypeModal
            persona={selectedArchetype}
            onClose={() => setSelectedArchetype(null)}
          />
        )}

        <div className="footer-note">
          KAIST IMMS · 졸업 프로젝트 프로토타입 · powered by OpenAI gpt-4o-mini
        </div>
      </main>
    </>
  );
}

// ── Results ────────────────────────────────────────────
function InfoTip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span
      style={{ position: 'relative', display: 'inline-block', marginLeft: 5, flexShrink: 0, verticalAlign: 'middle' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 15, height: 15, borderRadius: '50%',
        background: 'rgba(100,100,120,0.15)', color: '#888',
        fontSize: 9, fontWeight: 800, cursor: 'help', userSelect: 'none',
        border: '1px solid rgba(100,100,120,0.2)',
      }}>?</span>
      {show && (
        <div style={{
          position: 'absolute', zIndex: 999,
          bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
          background: '#1e1e2e', color: '#d4d4e8',
          padding: '10px 13px', borderRadius: 8,
          fontSize: 11, lineHeight: 1.65, fontWeight: 400,
          width: 270, boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          whiteSpace: 'normal', pointerEvents: 'none',
          border: '1px solid rgba(255,255,255,0.08)',
        }}>
          {text}
          <div style={{
            position: 'absolute', bottom: -5, left: '50%',
            transform: 'translateX(-50%) rotate(45deg)',
            width: 10, height: 10, background: '#1e1e2e',
            borderRight: '1px solid rgba(255,255,255,0.08)',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }} />
        </div>
      )}
    </span>
  );
}

function CohortTable({ data, discussion }: { data: Record<string, { n: number; Q0: number; Q1: number; Q2: number }>; discussion: boolean }) {
  const entries = Object.entries(data).sort((a, b) => a[1].Q1 - b[1].Q1);
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--line)' }}>
          <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--ink-mute)', fontSize: 11 }}>그룹</th>
          <th style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 600, color: 'var(--ink-mute)', fontSize: 11 }}>N</th>
          <th style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 600, color: 'var(--ink-mute)', fontSize: 11 }}>기본가 Q₀</th>
          <th style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 600, color: 'var(--ink-mute)', fontSize: 11 }}>인상 후 Q₁</th>
          {discussion && <th style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 600, color: 'var(--ink-mute)', fontSize: 11 }}>토론 후 Q₂</th>}
          <th style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 600, color: 'var(--ink-mute)', fontSize: 11 }}>변화</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([key, v]) => {
          const delta = (v.Q1 - v.Q0) * 100;
          return (
            <tr key={key} style={{ borderBottom: '1px solid var(--line)' }}>
              <td style={{ padding: '7px 8px', fontWeight: 600 }}>{key}</td>
              <td style={{ padding: '7px 8px', textAlign: 'center', color: 'var(--ink-mute)' }}>{v.n}</td>
              <td style={{ padding: '7px 8px', textAlign: 'center' }}>{fmtPct(v.Q0, 0)}</td>
              <td style={{ padding: '7px 8px', textAlign: 'center' }}>{fmtPct(v.Q1, 0)}</td>
              {discussion && <td style={{ padding: '7px 8px', textAlign: 'center' }}>{fmtPct(v.Q2, 0)}</td>}
              <td style={{ padding: '7px 8px', textAlign: 'center', fontWeight: 700, color: delta < -5 ? '#e85d3a' : delta > 5 ? '#2d7d6c' : 'var(--ink-mute)' }}>
                {fmtSigned(delta, 1)}%p
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ResultsView({
  result,
  personas,
}: {
  result: SimulateResponse;
  personas: Persona[];
}) {
  const [cohortTab, setCohortTab] = useState<'gen' | 'val' | 'inc' | 'house'>('gen');
  const [shownDecisions, setShownDecisions] = useState(10);
  const [shownComments, setShownComments] = useState(3);

  const { product, deltaPct, discussion, decisions, thread, metrics, populationSize } = result;
  const newPrice = Math.round(product.basePrice * (1 + deltaPct / 100));
  const elasticityClass = Math.abs(metrics.elasticity_sim) > 1 ? '탄력적' : '비탄력적';
  const womDesc = !discussion ? '토론 미포함' : metrics.wom_m > 1.1 ? '캐스케이드' : metrics.wom_m < 0.9 ? '밴드왜건' : '중립';

  // ── Auto insights ──────────────────────────────────────
  const insights: string[] = [];
  const q1Drop = (metrics.Q0 - metrics.Q1) * 100;
  insights.push(
    `가격 +${deltaPct}% 시 구매율 ${fmtPct(metrics.Q0, 0)} → ${fmtPct(metrics.Q1, 0)} (${fmtSigned(-q1Drop, 1)}%p), ε=${metrics.elasticity_sim.toFixed(2)} → ${elasticityClass}`
  );
  if (discussion) {
    const womNote = metrics.wom_m > 1.1 ? `커뮤니티 토론이 가격 저항을 ${((metrics.wom_m - 1) * 100).toFixed(0)}% 증폭 (정보 캐스케이드)` : metrics.wom_m < 0.9 ? `커뮤니티 토론이 저항을 ${((1 - metrics.wom_m) * 100).toFixed(0)}% 완화 (밴드왜건)` : '커뮤니티 토론의 순 구전 효과 중립적';
    insights.push(womNote + ` · WOM_m = ${metrics.wom_m.toFixed(2)}`);
    if (metrics.mcnemar.significant) insights.push(`McNemar χ²=${metrics.mcnemar.chi2.toFixed(2)} (p<0.05 유의) — 토론이 의사결정을 통계적으로 유의하게 변화시킴`);
    else insights.push(`McNemar χ²=${metrics.mcnemar.chi2.toFixed(2)} (n.s.) — 토론 전후 개별 flip 패턴 통계적으로 유의하지 않음`);
  }
  const cGen = metrics.cohort?.gen;
  if (cGen) {
    const sorted = Object.entries(cGen).sort((a, b) => a[1].Q1 - b[1].Q1);
    if (sorted.length >= 2) {
      const [low, lowV] = sorted[0];
      const [high, highV] = sorted[sorted.length - 1];
      insights.push(`세대별 구매율: ${high}세대 ${fmtPct(highV.Q1, 0)} vs ${low}세대 ${fmtPct(lowV.Q1, 0)} — ${Math.abs(highV.Q1 - lowV.Q1) > 0.15 ? '세대 간 가격 민감도 차이 뚜렷' : '세대 간 차이 미미'}`);
    }
  }
  const cVal = metrics.cohort?.val;
  if (cVal) {
    const entries = Object.entries(cVal);
    const gs = entries.find(([k]) => k === '가성비');
    const br = entries.find(([k]) => k === '브랜드');
    if (gs && br) {
      const diff = (gs[1].Q1 - br[1].Q1) * 100;
      insights.push(`가성비 우선 그룹 Q₁=${fmtPct(gs[1].Q1, 0)} vs 브랜드 충성 그룹 Q₁=${fmtPct(br[1].Q1, 0)} (차이 ${fmtSigned(diff, 1)}%p) — ${Math.abs(diff) > 10 ? (diff > 0 ? '가성비 그룹이 가격 인상에 더 수용적' : '브랜드 그룹이 더 수용적') : '가치관별 유의미한 차이 없음'}`);
    }
  }

  // ── Cohort tabs config ──
  const COHORT_TABS = [
    { key: 'gen' as const, label: '세대별' },
    { key: 'val' as const, label: '가치관별' },
    { key: 'inc' as const, label: '소득별' },
    { key: 'house' as const, label: '가구유형별' },
  ];
  // Handle both new format {gen:{...},val:{...}} and legacy flat format {Z:{...},M:{...}}
  const isNewCohort = metrics.cohort && 'gen' in metrics.cohort;
  const legacyGenData = !isNewCohort && metrics.cohort ? (metrics.cohort as unknown as Record<string, { n: number; Q0: number; Q1: number; Q2: number }>) : null;
  const activeCohortData: Record<string, { n: number; Q0: number; Q1: number; Q2: number }> =
    isNewCohort ? (metrics.cohort as unknown as Record<string, Record<string, { n: number; Q0: number; Q1: number; Q2: number }>>)[cohortTab] ?? {}
    : cohortTab === 'gen' && legacyGenData ? legacyGenData
    : {};

  const STEP_BTN = { padding: '3px 12px', fontSize: 11, fontWeight: 600, borderRadius: 20, cursor: 'pointer', border: '1px solid var(--line)', background: 'var(--paper-2)', color: 'var(--ink-soft)' };

  return (
    <section className="flow-section">
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 28 }}>{product.emoji}</span>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{product.name}</h2>
          <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 2 }}>
            {fmtKRW(product.basePrice)} → <strong style={{ color: 'var(--ink)' }}>{fmtKRW(newPrice)}</strong> ({fmtSigned(deltaPct, 0)}%) ·{' '}
            {product.goodType === 'search' ? '탐색재' : '경험재'} · N = {populationSize.toLocaleString()}명
          </div>
        </div>
      </div>

      {/* ── Metric cards ── */}
      <div className="results-summary" style={{ marginBottom: 16 }}>
        <div className="metric-card">
          <div className="metric-label" style={{ display: 'flex', alignItems: 'center', fontWeight: 700, fontSize: 11, letterSpacing: '0.02em' }}>
            ε_sim — 가격 탄력성
            <InfoTip text="가격 탄력성 (ε_sim): 가격 1% 인상 시 구매율이 몇 % 변하는지. |ε|>1 탄력적(가격 민감·대체재 풍부), |ε|≤1 비탄력적(브랜드 의존·경험재). ε < 0이 정상 (가격↑ → 구매↓)." />
          </div>
          <div className="metric-value" style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em', color: Math.abs(metrics.elasticity_sim) > 1 ? '#1e2761' : '#c9a961' }}>{metrics.elasticity_sim.toFixed(2)}</div>
          <div className="metric-sub" style={{ fontWeight: 600 }}>|ε| {Math.abs(metrics.elasticity_sim) > 1 ? '>' : '≤'} 1 · {elasticityClass}</div>
        </div>
        <div className="metric-card gold">
          <div className="metric-label" style={{ display: 'flex', alignItems: 'center', fontWeight: 700, fontSize: 11, letterSpacing: '0.02em' }}>
            구매율 변화
            <InfoTip text="Q₀(기본가 구매율) → Q₁(인상가 1차 결정) → Q₂(토론 후 2차 결정). 가격 인상이 구매 의향을 얼마나 바꿨는지. 음수 값이 경제적으로 정상(가격↑→수요↓). 양수면 소수N의 LLM 노이즈일 수 있음." />
          </div>
          <div className="metric-value" style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em', color: (metrics.Q1 - metrics.Q0) < 0 ? '#2d7d6c' : '#e85d3a' }}>
            {fmtSigned((metrics.Q1 - metrics.Q0) * 100, 1)}%p
          </div>
          <div className="metric-sub" style={{ fontWeight: 600 }}>
            {fmtPct(metrics.Q0, 0)} → <strong>{fmtPct(metrics.Q1, 0)}</strong>{discussion ? <span style={{ color: '#2d7d6c' }}> → {fmtPct(metrics.Q2, 0)}</span> : ''}
          </div>
        </div>
        <div className="metric-card green">
          <div className="metric-label" style={{ display: 'flex', alignItems: 'center', fontWeight: 700, fontSize: 11, letterSpacing: '0.02em' }}>
            WOM_m — 구전 승수
            <InfoTip text="Word-of-Mouth Multiplier: (Q₀−Q₂)÷(Q₀−Q₁). >1이면 토론이 가격 저항 증폭(정보 캐스케이드), <1이면 저항 완화(밴드왜건 효과), ≈1이면 중립. |Q₀−Q₁|≈0이면 분모가 0에 가까워 극단값이 나올 수 있음." />
          </div>
          <div className="metric-value" style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em' }}>{discussion ? metrics.wom_m.toFixed(2) : '—'}</div>
          <div className="metric-sub" style={{ fontWeight: 600 }}>{womDesc}</div>
        </div>
        <div className="metric-card red">
          <div className="metric-label" style={{ display: 'flex', alignItems: 'center', fontWeight: 700, fontSize: 11, letterSpacing: '0.02em' }}>
            McNemar χ²
            <InfoTip text="맥네마 검정: 토론 전·후 개인 결정 변화(flip)의 통계적 유의성. b=1차구매→2차포기, c=1차포기→2차구매. χ²=(|b−c|−1)²÷(b+c). χ²>3.84이면 p<0.05로 유의 — 토론이 결정을 유의미하게 바꿨음을 의미." />
          </div>
          <div className="metric-value" style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em' }}>{discussion ? metrics.mcnemar.chi2.toFixed(2) : '—'}</div>
          <div className="metric-sub" style={{ fontWeight: 600 }}>
            {discussion ? `b=${metrics.mcnemar.b}, c=${metrics.mcnemar.c} · ${metrics.mcnemar.significant ? '✓ p<0.05 유의' : 'n.s.'}` : '토론 미포함'}
          </div>
        </div>
      </div>

      {/* ── Insights ── */}
      <div className="flow-stage" style={{ background: 'var(--paper-2)', borderLeft: '3px solid var(--navy)' }}>
        <h4 style={{ marginTop: 0, color: 'var(--navy)', fontSize: 13 }}>핵심 인사이트</h4>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.85, color: 'var(--ink-soft)' }}>
          {insights.map((ins, i) => <li key={i}>{ins}</li>)}
        </ul>
      </div>

      {/* ── Demand curve ── */}
      <DemandCurve decisions={result.decisions} deltaPct={deltaPct} goodType={product.goodType} />

      {/* ── Cohort breakdown ── */}
      <div className="flow-stage">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <h4 style={{ margin: 0, fontSize: 14 }}>코호트별 구매율 분석</h4>
          <div style={{ display: 'flex', gap: 6 }}>
            {COHORT_TABS.map(t => (
              <button key={t.key} onClick={() => setCohortTab(t.key)} style={{ ...STEP_BTN, background: cohortTab === t.key ? 'var(--navy)' : 'var(--paper-2)', color: cohortTab === t.key ? '#fff' : 'var(--ink-soft)' }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {Object.keys(activeCohortData).length > 0
          ? <CohortTable data={activeCohortData} discussion={discussion} />
          : <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>데이터 없음 (이 결과를 다시 시뮬레이션하면 표시됩니다)</div>
        }
      </div>

      {/* ── Discussion thread ── */}
      {thread && (
        <div className="flow-stage">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <h4 style={{ margin: 0, fontSize: 14 }}>커뮤니티 토론 (오피니언 리더 + 댓글)</h4>
            <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{Math.min(shownComments, thread.comments.length)}/{thread.comments.length}개 표시</span>
          </div>
          {(() => {
            const archetypeId = thread.leader.agent_id.replace(/^agent-/, '').replace(/-\d+$/, '');
            const leader = personas.find((p) => p.id === archetypeId);
            return (
              <div className="thread-leader">
                <div className="thread-leader-name">{leader?.name ?? archetypeId} · {leader?.archetype}</div>
                <div style={{ color: 'var(--ink-soft)' }}>{thread.leader.seedPost}</div>
              </div>
            );
          })()}
          {thread.comments.slice(0, shownComments).map((c, i) => {
            const archetypeId = c.agent_id.replace(/^agent-/, '').replace(/-\d+$/, '');
            const p = personas.find((x) => x.id === archetypeId);
            return (
              <div className="thread-comment" key={i}>
                <span className="thread-comment-name">{p?.name ?? archetypeId}</span>
                <span className="thread-comment-text">{c.text}</span>
              </div>
            );
          })}
          {shownComments < thread.comments.length && (
            <button onClick={() => setShownComments(n => Math.min(n + 3, thread.comments.length))}
              style={{ marginTop: 8, padding: '5px 16px', fontSize: 11, cursor: 'pointer', border: '1px solid var(--line)', borderRadius: 16, background: 'var(--paper-2)', color: 'var(--ink-soft)' }}>
              댓글 더 보기 ({thread.comments.length - shownComments}개 남음)
            </button>
          )}
        </div>
      )}

      {/* ── Decisions table ── */}
      <div className="flow-stage">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <h4 style={{ margin: 0, fontSize: 14 }}>페르소나별 의사결정 내역</h4>
          <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{shownDecisions}/{decisions.length}명 표시</span>
        </div>
        <table className="decision-table">
          <thead>
            <tr>
              <th>페르소나</th>
              <th title="구매 여부 + conf: 에이전트의 결정 확신도 (1=매우 불확실, 5=매우 확실)">1차 <span style={{ fontSize: 9, color: 'var(--ink-mute)', fontWeight: 400 }}>(conf 1~5)</span></th>
              {discussion && <th>2차</th>}
              <th>가치관</th>
              <th>근거 (CoT)</th>
            </tr>
          </thead>
          <tbody>
            {decisions.slice(0, shownDecisions).map((d) => {
              const archetypeId = d.agent_id.replace(/^agent-/, '').replace(/-\d+$/, '');
              const p = personas.find((x) => x.id === archetypeId);
              if (!p) return null;
              const s2 = d.postDiscussionDecision;
              const flipped = discussion && s2 && s2.buy !== d.preDiscussionDecision.buy;
              return (
                <tr key={d.agent_id}>
                  <td>
                    <span className="mini-avatar">
                      <img src={avatarURL({ ...p, id: d.agent_id, name: d.agent_name })} alt={`${d.agent_name} 아바타`} />
                    </span>
                    <strong>{d.agent_name}</strong>
                    <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginLeft: 42, marginTop: -2 }}>{p.archetype}</div>
                  </td>
                  <td>
                    {d.preDiscussionDecision.buy ? <span className="badge-yes">구매</span> : <span className="badge-no">포기</span>}
                    <div style={{ fontSize: 10, color: 'var(--ink-mute)', marginTop: 4 }}>conf {d.preDiscussionDecision.confidence}/5</div>
                  </td>
                  {discussion && (
                    <td>
                      {s2 ? (
                        <>
                          {s2.buy ? <span className="badge-yes">구매</span> : <span className="badge-no">포기</span>}
                          {flipped && <span className="flip-tag">FLIP</span>}
                          <div style={{ fontSize: 10, color: 'var(--ink-mute)', marginTop: 4 }}>conf {s2.confidence}/5</div>
                        </>
                      ) : <span style={{ color: 'var(--ink-mute)' }}>—</span>}
                    </td>
                  )}
                  <td><span className="persona-value-tag">{dominantValue(p)}</span></td>
                  <td className="rationale">{(s2 ?? d.preDiscussionDecision).rationale_cot}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shownDecisions < decisions.length && (
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <button onClick={() => setShownDecisions(n => Math.min(n + 10, decisions.length))} style={{ ...STEP_BTN, padding: '6px 20px', fontSize: 12 }}>
              10개 더 보기 ({decisions.length - shownDecisions}개 남음)
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Archetype detail modal ────────────────────────────
function ArchetypeModal({
  persona,
  onClose,
}: {
  persona: Persona;
  onClose: () => void;
}) {
  const valMap: Record<string, string> = {
    gaseong: '가성비',
    gasim: '가심비',
    meaning: '미닝아웃',
    brand: '브랜드 충성',
  };
  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="닫기">
          ×
        </button>
        <div className="modal-header">
          <div className="modal-avatar">
            <img src={avatarURL(persona)} alt={`${persona.name} 아바타`} />
          </div>
          <div>
            <div className="modal-name">
              {persona.name} ({persona.nameEn})
            </div>
            <div className="modal-archetype">
              {persona.archetype} · {persona.gen}세대
            </div>
            <div className="modal-bio">{persona.bio}</div>
          </div>
        </div>
        <div className="detail-grid">
          <div className="detail-block">
            <h4>① Demographics</h4>
            <div className="detail-row">
              <span>성별·연령</span>
              <span>
                {persona.sex === 'M' ? '남' : '여'} · {persona.age}세
              </span>
            </div>
            <div className="detail-row">
              <span>거주지</span>
              <span>{persona.region}</span>
            </div>
            <div className="detail-row">
              <span>가구</span>
              <span>{persona.household}</span>
            </div>
            <div className="detail-row">
              <span>직업</span>
              <span>{persona.occupation}</span>
            </div>
          </div>
          <div className="detail-block red">
            <h4>② Economics</h4>
            <div className="detail-row">
              <span>월 소득 (아키타입 기준)</span>
              <span>{persona.income.toLocaleString()}원</span>
            </div>
            <div className="detail-row">
              <span>저축률</span>
              <span>{(persona.savings_rate * 100).toFixed(0)}%</span>
            </div>
            <div className="detail-row">
              <span>부채</span>
              <span style={{ fontSize: 11 }}>{persona.debt}</span>
            </div>
          </div>
          <div className="detail-block gold">
            <h4>③ Values</h4>
            {Object.entries(persona.values).map(([k, v]) => (
              <div className="value-bar" key={k}>
                <span className="value-bar-label">{valMap[k]}</span>
                <span className="value-bar-track">
                  <span
                    className="value-bar-fill"
                    style={{ width: `${v * 100}%` }}
                  />
                </span>
                <span className="value-bar-pct">{(v * 100).toFixed(0)}</span>
              </div>
            ))}
          </div>
          <div className="detail-block green">
            <h4>④ Lifestyle</h4>
            <div className="value-bar">
              <span className="value-bar-label">모니터 관심</span>
              <span className="value-bar-track">
                <span
                  className="value-bar-fill"
                  style={{
                    width: `${persona.lifestyle.monitor_interest * 100}%`,
                  }}
                />
              </span>
              <span className="value-bar-pct">
                {(persona.lifestyle.monitor_interest * 100).toFixed(0)}
              </span>
            </div>
            <div className="value-bar">
              <span className="value-bar-label">화장품 관심</span>
              <span className="value-bar-track">
                <span
                  className="value-bar-fill"
                  style={{
                    width: `${persona.lifestyle.cosmetics_interest * 100}%`,
                  }}
                />
              </span>
              <span className="value-bar-pct">
                {(persona.lifestyle.cosmetics_interest * 100).toFixed(0)}
              </span>
            </div>
          </div>
        </div>
        <div className="modal-sources">출처: {persona.sources}</div>
      </div>
    </div>
  );
}

function MiniDonut({
  slices,
  size = 72,
}: {
  slices: { pct: number; color: string }[];
  size?: number;
}) {
  const cx = size / 2, cy = size / 2;
  const R = size / 2 - 3;
  const r = R * 0.52;
  const total = slices.reduce((s, d) => s + d.pct, 0) || 1;
  let angle = -Math.PI / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      {slices.map((s, i) => {
        const sweep = (s.pct / total) * 2 * Math.PI;
        const end = angle + sweep;
        const x1 = cx + R * Math.cos(angle), y1 = cy + R * Math.sin(angle);
        const x2 = cx + R * Math.cos(end),   y2 = cy + R * Math.sin(end);
        const xi1 = cx + r * Math.cos(end),  yi1 = cy + r * Math.sin(end);
        const xi2 = cx + r * Math.cos(angle),yi2 = cy + r * Math.sin(angle);
        const lg = sweep > Math.PI ? 1 : 0;
        const d = `M${x1},${y1} A${R},${R} 0 ${lg},1 ${x2},${y2} L${xi1},${yi1} A${r},${r} 0 ${lg},0 ${xi2},${yi2} Z`;
        angle = end;
        return <path key={i} d={d} fill={s.color} />;
      })}
    </svg>
  );
}

function DemandCurve({
  decisions,
  deltaPct,
  goodType,
}: {
  decisions: SimulateResponse['decisions'];
  deltaPct: number;
  goodType: GoodType;
}) {
  const n = Math.max(1, decisions.length);
  const Q0    = decisions.filter(d => d.baselineDecision.buy).length / n;
  const Q1pre = decisions.filter(d => d.preDiscussionDecision.buy).length / n;
  const hasDisc = decisions.some(d => d.postDiscussionDecision != null);
  const Q1post = hasDisc ? decisions.filter(d => d.postDiscussionDecision?.buy).length / n : null;

  const anomaly = Q1pre > Q0;
  const c1 = anomaly ? '#e85d3a' : (goodType === 'search' ? '#1e2761' : '#b8892a');
  const c2 = '#2d7d6c';

  // Large viewBox so 1 viewBox unit ≈ 1 screen px (SVG renders at ~560px wide)
  // fontSize="9" in viewBox → ~9–11px on screen. Much easier to reason about.
  const W = 560, H = 180;
  const pL = 36, pR = 44, pT = 20, pB = 34;
  const plotW = W - pL - pR, plotH = H - pT - pB;
  const xL = pL, xR = pL + plotW;
  const yFn = (v: number) => pT + (1 - Math.max(0, Math.min(1, v))) * plotH;

  // Label y: prefer above the dot, flip below if near top edge
  const lbl = (v: number): number => {
    const above = yFn(v) - 16;
    return above < pT ? yFn(v) + 22 : above;
  };
  // Separate Q1pre/Q1post labels when they're too close vertically
  const bothPresent = Q1post !== null;
  const closeEnough = bothPresent && Math.abs(yFn(Q1pre) - yFn(Q1post!)) < 26;
  const ly1pre  = closeEnough && Q1pre >= (Q1post ?? 0) ? yFn(Q1pre) - 18 : lbl(Q1pre);
  const ly1post = bothPresent ? (closeEnough && Q1pre < Q1post! ? yFn(Q1post!) - 18 : lbl(Q1post!)) : 0;

  return (
    <div className="curve-panel">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>
          수요 곡선 (ΔP → ΔQ)
          <InfoTip text="가격 변동(ΔP)에 따른 구매율(Q) 변화. 선이 우하향 = 정상(가격↑→수요↓). 우상향이면 N이 작을 때 LLM 샘플링 노이즈. 초록 점선 = 커뮤니티 토론 후 Q₂." />
        </h4>
        {/* Legend */}
        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#666', marginLeft: 4 }}>
          <span style={{ display:'flex', alignItems:'center', gap:5 }}>
            <span style={{ width:18, height:3, background:c1, display:'inline-block', borderRadius:2, verticalAlign:'middle' }}/>
            1차 (Q₁)
          </span>
          {hasDisc && <span style={{ display:'flex', alignItems:'center', gap:5 }}>
            <span style={{ width:18, height:3, background:c2, display:'inline-block', borderRadius:2, verticalAlign:'middle',
              backgroundImage:`repeating-linear-gradient(90deg,${c2} 0,${c2} 5px,transparent 5px,transparent 9px)`,
              backgroundSize:'9px 3px', backgroundRepeat:'repeat-x', backgroundPositionY:'center',
            }}/>
            토론 후 (Q₂)
          </span>}
          {anomaly && <span style={{ fontSize:10, color:'#e85d3a', fontWeight:600 }}>⚠ Q₁&gt;Q₀ · N 부족</span>}
        </div>
      </div>

      {/* Chart — viewBox ≈ rendered px so fontSize="9" ≈ 9px on screen */}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {/* Y gridlines + labels */}
        {[0, 0.25, 0.5, 0.75, 1].map(t => (
          <g key={t}>
            <line x1={pL} y1={yFn(t)} x2={W - pR} y2={yFn(t)}
              stroke={t === 0 ? '#d4d4d4' : 'rgba(0,0,0,0.07)'}
              strokeDasharray={t === 0 ? undefined : '3 5'} />
            <text x={pL - 5} y={yFn(t) + 3.5} fontSize="9" fill="#c4c4c4" textAnchor="end">
              {(t * 100).toFixed(0)}%
            </text>
          </g>
        ))}
        {/* Axes */}
        <line x1={pL} y1={pT - 4} x2={pL} y2={H - pB} stroke="#e4e4e4" />
        <line x1={pL} y1={H - pB} x2={W - pR} y2={H - pB} stroke="#e4e4e4" />
        {/* X tick marks + labels */}
        <line x1={xL} y1={H - pB} x2={xL} y2={H - pB + 4} stroke="#ccc" />
        <line x1={xR} y1={H - pB} x2={xR} y2={H - pB + 4} stroke="#ccc" />
        <text x={xL} y={H - pB + 13} fontSize="9" fill="#bbb" textAnchor="middle">기본가</text>
        <text x={xR} y={H - pB + 13} fontSize="9" fill="#bbb" textAnchor="middle">+{deltaPct}%</text>

        {/* Area fill under 1차 curve */}
        <polygon
          points={`${xL},${yFn(0)} ${xL},${yFn(Q0)} ${xR},${yFn(Q1pre)} ${xR},${yFn(0)}`}
          fill={goodType === 'search' ? 'rgba(30,39,97,0.07)' : 'rgba(184,137,42,0.09)'}
          opacity={anomaly ? 0.3 : 1}
        />
        {/* 1차 demand line */}
        <line x1={xL} y1={yFn(Q0)} x2={xR} y2={yFn(Q1pre)}
          stroke={c1} strokeWidth="2" strokeLinecap="round" />
        {/* 토론후 dashed line */}
        {Q1post !== null && (
          <line x1={xL} y1={yFn(Q0)} x2={xR} y2={yFn(Q1post)}
            stroke={c2} strokeWidth="1.6" strokeDasharray="6 4" strokeLinecap="round" />
        )}

        {/* Q0 — dot on LEFT, label to the right of dot */}
        <circle cx={xL} cy={yFn(Q0)} r="4" fill={c1} stroke="#fff" strokeWidth="1.5" />
        <text x={xL + 8} y={lbl(Q0) + 4} fontSize="11" fill={c1} textAnchor="start" fontWeight="bold">
          {(Q0 * 100).toFixed(0)}%
        </text>
        <text x={xL + 8} y={lbl(Q0) + 15} fontSize="8" fill="#c0c0c0" textAnchor="start">Q0</text>

        {/* Q1 — dot on RIGHT, label to the left */}
        <circle cx={xR} cy={yFn(Q1pre)} r="4" fill={c1} stroke="#fff" strokeWidth="1.5" />
        <text x={xR + 6} y={ly1pre + 4} fontSize="11" fill={c1} textAnchor="start" fontWeight="bold">
          {(Q1pre * 100).toFixed(0)}%
        </text>
        <text x={xR + 6} y={ly1pre + 15} fontSize="8" fill="#c0c0c0" textAnchor="start">Q1</text>

        {/* Q2 — dot slightly offset, label to the right */}
        {Q1post !== null && (
          <>
            <circle cx={xR} cy={yFn(Q1post)} r="4" fill={c2} stroke="#fff" strokeWidth="1.5" />
            <text x={xR + 6} y={ly1post + 4} fontSize="11" fill={c2} textAnchor="start" fontWeight="bold">
              {(Q1post * 100).toFixed(0)}%
            </text>
            <text x={xR + 6} y={ly1post + 15} fontSize="8" fill="#c0c0c0" textAnchor="start">Q2</text>
          </>
        )}
      </svg>
    </div>
  );
}
