import { NextResponse } from 'next/server';
import { PERSONAS } from '@/lib/personas';
import { generatePopulationAgents } from '@/lib/instances';
import type {
  Agent,
  ActiveProduct,
  Decision,
  AgentDecision,
  SimulateRequest,
  SimulateResponse,
} from '@/lib/types';
import {
  callDecide,
  callSeedPost,
  callComment,
  callDecideBatch,
} from '@/lib/openai';

export const runtime = 'nodejs';
export const maxDuration = 60;

const RATE: Map<string, number[]> = new Map();
function rateLimited(ip: string, limit = 5, windowMs = 60_000) {
  const now = Date.now();
  const arr = (RATE.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    RATE.set(ip, arr);
    return true;
  }
  arr.push(now);
  RATE.set(ip, arr);
  return false;
}

function buyRate(decisions: Decision[]) {
  if (decisions.length === 0) return 0;
  return decisions.filter((d) => d.buy).length / decisions.length;
}

function mcnemar(pre: Decision[], post: Decision[]) {
  let b = 0; // pre Yes / post No
  let c = 0; // pre No / post Yes
  for (let i = 0; i < pre.length; i++) {
    if (pre[i].buy && !post[i].buy) b++;
    if (!pre[i].buy && post[i].buy) c++;
  }
  const denom = b + c;
  const chi2 = denom > 0 ? Math.pow(Math.abs(b - c) - 1, 2) / denom : 0;
  return { b, c, chi2, significant: chi2 > 3.84 };
}

type CohortBucket = Record<string, { n: number; Q0: number; Q1: number; Q2: number }>;

function buildBucket(key: string, bucket: CohortBucket, d: AgentDecision) {
  if (!bucket[key]) bucket[key] = { n: 0, Q0: 0, Q1: 0, Q2: 0 };
  bucket[key].n += 1;
  bucket[key].Q0 += d.baselineDecision.buy ? 1 : 0;
  bucket[key].Q1 += d.preDiscussionDecision.buy ? 1 : 0;
  bucket[key].Q2 += (d.postDiscussionDecision ?? d.preDiscussionDecision).buy ? 1 : 0;
}

function normBucket(b: CohortBucket): CohortBucket {
  for (const k of Object.keys(b)) {
    const r = b[k];
    if (r.n > 0) { r.Q0 /= r.n; r.Q1 /= r.n; r.Q2 /= r.n; }
  }
  return b;
}

function dominantVal(agent: Agent): string {
  const v = agent.values;
  const max = Math.max(v.gaseong, v.gasim, v.meaning, v.brand);
  if (max === v.meaning) return '미닝아웃';
  if (max === v.gasim) return '가심비';
  if (max === v.brand) return '브랜드';
  return '가성비';
}

function archetypeBuckets(decisions: AgentDecision[], agents: Agent[]) {
  const gen: CohortBucket = {};
  const val: CohortBucket = {};
  const inc: CohortBucket = {};
  const house: CohortBucket = {};

  for (const d of decisions) {
    const agent = agents.find((a) => a.agent_id === d.agent_id);
    if (!agent) continue;

    buildBucket(agent.gen, gen, d);
    buildBucket(dominantVal(agent), val, d);

    const incTier = agent.income / 10000 < 300 ? '저소득(<300만)' : agent.income / 10000 <= 500 ? '중소득(300-500만)' : '고소득(>500만)';
    buildBucket(incTier, inc, d);

    const houseLabel: Record<string, string> = { single: '1인가구', parents: '부모동거', dink: '딩크', family: '자녀가족', senior_couple: '시니어' };
    buildBucket(houseLabel[agent.householdCode] ?? agent.householdCode, house, d);
  }

  return {
    gen: normBucket(gen),
    val: normBucket(val),
    inc: normBucket(inc),
    house: normBucket(house),
  };
}

function pickLeader(
  agents: Agent[],
  preDecision: Decision[],
  goodType: 'search' | 'experience',
) {
  // For search goods, prefer a skeptic leader (triggers information cascade).
  // For experience goods, prefer an advocate leader (triggers bandwagon).
  const preferBuy = goodType === 'experience';
  const candidates = agents
    .map((p, i) => ({ p, d: preDecision[i] }))
    .filter((c) => c.d.buy === preferBuy)
    .sort((a, b) => b.d.confidence - a.d.confidence);
  // Fallback to most confident regardless of stance if no match
  if (candidates.length === 0) {
    return agents
      .map((p, i) => ({ p, d: preDecision[i] }))
      .sort((a, b) => b.d.confidence - a.d.confidence)[0] ?? null;
  }
  return candidates[0];
}

// Batch processing helper
async function mapInBatches<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const mapped = await Promise.all(batch.map(fn));
    results.push(...mapped);
  }
  return results;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function mapInBatchesEx<T>(
  items: Agent[],
  batchSize: number,
  delayMs: number,
  fn: (batch: Agent[]) => Promise<Decision[]>,
): Promise<Decision[]> {
  const results: Decision[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await fn(batch);
    results.push(...batchResults);
    if (i + batchSize < items.length) {
      await sleep(delayMs);
    }
  }
  return results;
}

export async function POST(request: Request) {
  // if (!process.env.OPENAI_API_KEY) {
  //   return NextResponse.json({ error: 'OPENAI_API_KEY가 설정되지 않았습니다.' }, { status: 500 });
  // }
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: '요청이 너무 많습니다. 1분 후 다시 시도해주세요.' },
      { status: 429 },
    );
  }

  try {
    const body = (await request.json()) as SimulateRequest;
    // Map popPerArch conceptually to total populationSize requested by client.
    // If client sends `populationSize`, use that. Otherwise fallback to `popPerArch * 16`.
    const { product, deltaPct, discussion } = body;
    const N = body.populationSize ? body.populationSize : 30;

    if (!product || typeof deltaPct !== 'number' || !N) {
      return NextResponse.json(
        { error: '잘못된 요청: product/deltaPct/populationSize가 필요합니다.' },
        { status: 400 },
      );
    }

    const basePrice = product.basePrice;
    const newPrice = Math.round(basePrice * (1 + deltaPct / 100));

    const agents = generatePopulationAgents(N, PERSONAS);

    // Scale batch size up for larger N to stay under 60s Vercel timeout.
    // gpt-4o-mini handles 80 agents per batch well within context limits.
    const BATCH_SIZE = N <= 30 ? 16 : 80;
    const DELAY_MS = N <= 30 ? 200 : 100;

    // Stage 1: Run base and priced decisions IN PARALLEL (they're independent)
    const [baseDecisions, priceDecisions] = await Promise.all([
      mapInBatchesEx(
        agents,
        BATCH_SIZE,
        DELAY_MS,
        async (batch) => {
          return callDecideBatch({
            agents: batch,
            product,
            basePrice,
            newPrice: basePrice,
            deltaPct: 0,
            stage: 'decide',
          });
        },
      ),
      mapInBatchesEx(
        agents,
        BATCH_SIZE,
        DELAY_MS,
        async (batch) => {
          return callDecideBatch({
            agents: batch,
            product,
            basePrice,
            newPrice,
            deltaPct,
            stage: 'decide',
          });
        },
      ),
    ]);

    const decisions: AgentDecision[] = agents.map((p, i) => ({
      agent_id: p.agent_id,
      agent_name: p.name,
      baselineDecision: baseDecisions[i] ?? {
        buy: false,
        confidence: 1,
        rationale_cot: 'err',
      },
      preDiscussionDecision: priceDecisions[i] ?? {
        buy: false,
        confidence: 1,
        rationale_cot: 'err',
      },
    }));

    // Guardrail: If didn't buy at base price, shouldn't buy at higher price (both good types)
    if (deltaPct > 0) {
      for (const d of decisions) {
        if (!d.baselineDecision.buy && d.preDiscussionDecision.buy) {
          d.preDiscussionDecision = { ...d.preDiscussionDecision, buy: false };
        }
      }
    }

    let thread: SimulateResponse['thread'] | undefined;

    if (discussion) {
      const leader = pickLeader(agents, priceDecisions, product.goodType);
      if (leader) {
        const stance: 'skeptic' | 'advocate' = leader.d.buy
          ? 'advocate'
          : 'skeptic';
        const seedPost = await callSeedPost(
          leader.p,
          product,
          basePrice,
          newPrice,
          deltaPct,
          stance,
        );

        // Scale comments down for large N to stay under timeout
        const others = agents.filter((p) => p.agent_id !== leader.p.agent_id);
        const commentCount = Math.min(N <= 30 ? 10 : 5, others.length);
        const commenters = commentCount <= others.length
          ? Array.from({ length: commentCount }, (_, k) =>
              others[Math.round((k / (commentCount - 1 || 1)) * (others.length - 1))])
          : others;

        const comments = await Promise.all(
          commenters.map(async (p) => ({
            agent_id: p.agent_id,
            agentName: p.name,
            text: await callComment(
              {
                agent: p,
                product,
                basePrice,
                newPrice,
                deltaPct,
                stage: 'comment',
              },
              { seedPost, topic: '댓글로 자신의 생각을 한 줄 남기세요.' },
            ),
          })),
        );

        thread = {
          leader: { agent_id: leader.p.agent_id, seedPost },
          comments: comments.map((c) => ({
            agent_id: c.agent_id,
            text: c.text,
          })),
        };

        await sleep(DELAY_MS);

        // Stage 2: re-decide with thread context
        const stage2 = await mapInBatchesEx(
          agents,
          BATCH_SIZE,
          DELAY_MS,
          (batch) =>
            callDecideBatch({
              agents: batch,
              product,
              basePrice,
              newPrice,
              deltaPct,
              stage: 'decide',
              seedPost,
              comments: comments.map((c) => ({
                agentName: agents.find((p) => p.agent_id === c.agent_id)!.name,
                text: c.text,
              })),
            }),
        );
        for (let i = 0; i < decisions.length; i++) {
          decisions[i].postDiscussionDecision = stage2[i] ?? {
            buy: false,
            confidence: 1,
            rationale_cot: 'err',
          };
          // Guardrail: didn't buy at base → can't buy after discussion at higher price
          if (deltaPct > 0 && !decisions[i].baselineDecision.buy && decisions[i].postDiscussionDecision?.buy) {
            decisions[i].postDiscussionDecision = { ...decisions[i].postDiscussionDecision!, buy: false };
          }
          decisions[i].flipped =
            decisions[i].preDiscussionDecision.buy !==
            (decisions[i].postDiscussionDecision?.buy ?? false);
        }
      }
    }

    // ── Metrics ──
    const Q0 = buyRate(decisions.map((d) => d.baselineDecision));
    const Q1 = buyRate(decisions.map((d) => d.preDiscussionDecision));
    const Q2 = buyRate(
      decisions.map((d) => d.postDiscussionDecision ?? d.preDiscussionDecision),
    );

    // Q0 -> Q1
    const deltaQ1 = Q1 - Q0;
    // Q0 -> Q2
    const deltaQ2 = Q2 - Q0;

    // Price Elasticity ε_sim (based on Q1 before discussion)
    const elasticity_sim =
      deltaPct !== 0 && Q0 > 0 ? deltaQ1 / Q0 / (deltaPct / 100) : 0;
    // Post-discussion Price Elasticity ε_post (based on Q2)
    const elasticity_post =
      deltaPct !== 0 && Q0 > 0 ? deltaQ2 / Q0 / (deltaPct / 100) : 0;

    // WOM_m: (Q0 - Q2) / (Q0 - Q1)
    const wom_m = Q0 - Q1 !== 0 ? (Q0 - Q2) / (Q0 - Q1) : 1;

    const mc = discussion
      ? mcnemar(
          decisions.map((d) => d.preDiscussionDecision),
          decisions.map(
            (d) => d.postDiscussionDecision ?? d.preDiscussionDecision,
          ),
        )
      : { b: 0, c: 0, chi2: 0, significant: false };

    const flipCount = decisions.filter((d) => Boolean(d.flipped)).length;

    const response: SimulateResponse = {
      product,
      deltaPct,
      discussion,
      decisions,
      thread,
      metrics: {
        Q0,
        Q1,
        Q2,
        deltaQ1,
        deltaQ2,
        elasticity_sim,
        elasticity_post,
        wom_m,
        mcnemar: mc,
        flipCount,
        cohort: archetypeBuckets(decisions, agents),
      },
      populationSize: N,
    };
    return NextResponse.json(response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
