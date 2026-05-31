import OpenAI from 'openai';
import type { Persona, Agent, ActiveProduct, Decision } from './types';

let _client: OpenAI | null = null;
function client(): OpenAI | null {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'mock') {
      console.warn(
        'OPENAI_API_KEY is not set or is "mock". Using MOCK responses.',
      );
      return null;
    }
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

export const MODEL = 'gpt-4o-mini';

export interface DecideRequest {
  agent: Agent;
  product: ActiveProduct;
  basePrice: number;
  newPrice: number;
  deltaPct: number;
  stage: 'decide' | 'comment';
  seedPost?: string;
  comments?: { agentName: string; text: string }[];
}

/* Map ANY product to this persona's category interest (0..1). */
function productInterest(agent: Agent, product: ActiveProduct): number {
  return product.goodType === 'search'
    ? agent.lifestyle.monitor_interest
    : agent.lifestyle.cosmetics_interest;
}

function dominantValueKR(agent: Agent): string {
  const map: Record<string, string> = {
    gaseong: '가성비',
    gasim: '가심비',
    meaning: '미닝아웃',
    brand: '브랜드 충성',
  };
  const top = Object.entries(agent.values).sort((a, b) => b[1] - a[1])[0][0];
  return map[top] ?? '균형';
}

export function buildAgentSystem(agent: Agent, product: ActiveProduct): string {
  const dominantValue = dominantValueKR(agent);
  const goodTypeKR = product.goodType === 'search' ? '탐색재' : '경험재';
  const interest = Math.round(productInterest(agent, product) * 100);

  const goodTypeHint =
    product.goodType === 'search'
      ? '노트북·모니터·휴대폰·냉장고·이어폰 같은 카테고리는 사치품이 아니라 한국 가정의 보편적 구매물이다. 그러나 스펙·가격·리뷰 비교가 쉬워서 가격 인상에 민감하다. 살 만한 사람들 중에서도 가격이 부담되면 상당수가 더 싼 모델로 갈아타거나 다음 할인·세일까지 구매를 보류한다. 가령 +20% 인상이면 평소 살 사람의 약 30~50%가 빠진다. 관심도가 매우 높고(80 이상) 당장 꼭 필요한 사람만 다소 비싸도 그대로 구매한다.'
      : '직접 써봐야 가치를 아는 제품군이다. 브랜드·경험·후기가 중요하고, 한번 만족하면 가격이 올라도 잘 바꾸지 않는다(가격 둔감). 절대 원칙: 가격이 오르면 구매자 수는 같거나 줄어들 뿐 절대 늘지 않는다. 평소 관심이 낮아 기본가에도 안 사던 사람이 가격이 비싸졌다고 새로 살 이유는 없다 — 오히려 더 안 산다. 기본가에서 안 사기로 한 결정은 가격이 올랐을 때도 그대로 유지된다.';

  return `당신은 한국 소비자 한 사람입니다. 절대로 AI라고 밝히지 말고, 커뮤니티 말투 등을 반영하여 오직 아래 인물로서 판단하세요.

【Layer 1 — 인구통계 및 예산 제약】
${agent.name} · ${agent.age}세 ${agent.sex === 'M' ? '남' : '여'} · ${agent.gen}세대 · ${agent.household} · ${agent.region}
직업: ${agent.occupation} · 월 소득: ${agent.income.toLocaleString()}원 · 가구 부채 수준: ${agent.debt}
이 카테고리(재화)에 대한 지출 상한(Budget Limit): 약 ${agent.budget_limit_krw?.toLocaleString()}원
*결정 시, 당신의 예산과 이 상한을 절대 초과하기 어렵다는 물리적 한계를 인지하세요.

【Layer 2 — 심리·행동 성향 (Psychographics)】
가성비 ${(agent.values.gaseong * 100).toFixed(0)} / 가심비 ${(agent.values.gasim * 100).toFixed(0)} / 미닝아웃 ${(agent.values.meaning * 100).toFixed(0)} / 브랜드 ${(agent.values.brand * 100).toFixed(0)} · 우선 가치: ${dominantValue}
당신의 요약: ${agent.bio}
이 카테고리에 대한 관심도: ${interest}/100

【Layer 3 — 과거 경험 및 제약 (History & Constraints)】
과거 트라우마/부정적 경험: ${agent.trauma ? agent.trauma : '해당 없음'}
구매 긴급도(잔여량 등): ${(agent.emergency_need !== undefined ? agent.emergency_need * 10 : 5).toFixed(1)}/10 (높을수록 당장 필요함)
탐색 체력(시간/에너지): ${(agent.search_capacity !== undefined ? agent.search_capacity * 10 : 5).toFixed(1)}/10 (낮으면 대안 검색을 포기하고 친숙한 기본안을 택하거나 구매를 포기함)

【Layer 4 — 거시경제 및 커뮤니티 화법 (Macro & Vibe)】
현재 체감 경제 상황: ${agent.macro_context ?? '평이한 물가와 경제 상황'}
커뮤니티 및 리뷰 작성 시 사용할 말투: ${agent.vibe_tone ?? '일반적인 인터넷 커뮤니티 말투'}

【${product.emoji} ${product.name} (${goodTypeKR}) 판단 원칙】
${goodTypeHint}
- 예산(Budget Limit)을 초과하는 가격이면 아무리 관심도가 높아도 구매하기 매우 어렵습니다 (물리적 한계).
- 트라우마가 있다면 브랜드 선택(경험재)에 보수적이게 됩니다.
- 긴급도가 높다면 웬만한 가격 인상은 감수합니다.
- 탐색 체력이 낮으면(스위칭 비용이 큼) 가격이 올랐을 때 귀찮아서 그냥 사거나 아예 안 삽니다.
- 다른 사람의 의견(토론)을 볼 때, 당신의 성향과 예산에 맞춰 동조하거나 오히려 반박하세요 (군중심리 또는 소신).`;
}

function buildDecideUser(req: DecideRequest): string {
  const { product, newPrice, seedPost, comments } = req;
  const priceLine = `가격: ${newPrice.toLocaleString()}원 / ${product.unit}`;

  const discussion = seedPost
    ? `\n\n【커뮤니티 토론】\n오피니언 리더: "${seedPost}"\n${(comments ?? []).map((c) => `· ${c.agentName}: "${c.text}"`).join('\n')}\n\n이 토론을 본 뒤 마음이 바뀌었을 수도, 그대로일 수도 있습니다. 솔직하게 다시 판단하세요.`
    : '';

  return `${product.emoji} ${product.name}
${priceLine}${discussion}

이 가격에 이 제품을 지금 사겠습니까? 당신의 관심도·예산·가치관에 비춰 솔직하게 판단하세요.

JSON으로만 응답:
- buy: true(산다) / false(안 산다)
- confidence: 1~5 (확신 정도)
- rationale_cot: 한국어 한 문장, 80자 이내`;
}

const decisionSchema = {
  type: 'object',
  properties: {
    buy: { type: 'boolean' },
    confidence: { type: 'integer', minimum: 1, maximum: 5 },
    rationale_cot: { type: 'string' },
  },
  required: ['buy', 'confidence', 'rationale_cot'],
  additionalProperties: false,
};

export async function callDecide(req: DecideRequest): Promise<Decision> {
  const openaiClient = client();

  // Mock fallback for local testing without API key
  if (!openaiClient) {
    await new Promise((r) => setTimeout(r, 100)); // simulate delay
    const buyProbability = req.agent.income >= req.newPrice ? 0.7 : 0.2;
    const buy = Math.random() < buyProbability;
    return {
      buy,
      confidence: Math.floor(Math.random() * 3) + 3,
      rationale_cot: buy
        ? '가격이 올랐지만 관심있는 제품이라 구매합니다.'
        : '예산 초과라서 구매를 포기합니다.',
    };
  }

  const completion = await openaiClient.chat.completions.create({
    model: MODEL,
    max_tokens: 400,
    temperature: 0.6,
    messages: [
      { role: 'system', content: buildAgentSystem(req.agent, req.product) },
      { role: 'user', content: buildDecideUser(req) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'decision', strict: true, schema: decisionSchema },
    },
  });
  const raw = completion.choices[0]?.message?.content ?? '';
  const parsed = JSON.parse(raw);
  return {
    buy: Boolean(parsed.buy),
    confidence: Math.max(1, Math.min(5, Number(parsed.confidence) || 3)),
    rationale_cot: String(parsed.rationale_cot ?? '').slice(0, 160),
  };
}

export async function callComment(
  req: DecideRequest,
  ctx: { seedPost: string; topic: string },
): Promise<string> {
  const openaiClient = client();

  if (!openaiClient) {
    await new Promise((r) => setTimeout(r, 100)); // simulate delay
    return `[Mock] ${req.agent.name}의 모의 댓글입니다.`;
  }

  const completion = await openaiClient.chat.completions.create({
    model: MODEL,
    max_tokens: 200,
    temperature: 1.0,
    messages: [
      { role: 'system', content: buildAgentSystem(req.agent, req.product) },
      {
        role: 'user',
        content: `한국 커뮤니티 게시판에 다음 글이 올라왔습니다:\n"${ctx.seedPost}"\n\n${ctx.topic}\n\n당신의 어투로 120자 이내 한국어 댓글 하나만. 댓글 내용만, 따옴표·접두어 없이.`,
      },
    ],
  });
  return (completion.choices[0]?.message?.content ?? '').trim().slice(0, 160);
}

export async function callSeedPost(
  agent: Agent,
  product: ActiveProduct,
  basePrice: number,
  newPrice: number,
  deltaPct: number,
  stance: 'skeptic' | 'advocate',
): Promise<string> {
  const openaiClient = client();

  if (!openaiClient) {
    await new Promise((r) => setTimeout(r, 100)); // simulate delay
    return `[Mock] ${agent.name}의 모의 ${stance === 'skeptic' ? '회의적' : '긍정적'} 커뮤니티 게시글입니다.`;
  }

  const stanceHint =
    stance === 'skeptic'
      ? '가격이 비싸다고 회의적·비판적인 톤으로'
      : '제품 가치를 지지하며 이 가격도 살 만하다는 톤으로';
  const completion = await openaiClient.chat.completions.create({
    model: MODEL,
    max_tokens: 300,
    temperature: 1.0,
    messages: [
      { role: 'system', content: buildAgentSystem(agent, product) },
      {
        role: 'user',
        content: `한국 커뮤니티(디시·뽐뿌·올리브영 리뷰 등)에 ${stanceHint} 글을 한 단락(최대 200자) 쓰세요. ${product.emoji} ${product.name}이 ${newPrice.toLocaleString()}원입니다. 본문만, 제목·따옴표·자기소개 없이.`,
      },
    ],
  });
  return (completion.choices[0]?.message?.content ?? '').trim().slice(0, 280);
}

export interface DecideBatchRequest {
  agents: Agent[];
  product: ActiveProduct;
  basePrice: number;
  newPrice: number;
  deltaPct: number;
  stage: 'decide' | 'comment';
  seedPost?: string;
  comments?: { agentName: string; text: string }[];
}

export async function callDecideBatch(
  req: DecideBatchRequest,
): Promise<Decision[]> {
  const openaiClient = client();

  if (!openaiClient) {
    await new Promise((r) => setTimeout(r, 100)); // simulate delay
    return req.agents.map((agent) => {
      const buyProbability = agent.income >= req.newPrice ? 0.7 : 0.2;
      const buy = Math.random() < buyProbability;
      return {
        buy,
        confidence: Math.floor(Math.random() * 3) + 3,
        rationale_cot: buy
          ? '가격이 올랐지만 관심있어 구매합니다.'
          : '예산초과 등 이유로 포기합니다.',
      };
    });
  }

  const { product, newPrice, seedPost, comments, agents } = req;
  const goodTypeKR = product.goodType === 'search' ? '탐색재' : '경험재';
  const goodTypeHint =
    product.goodType === 'search'
      ? '노트북·모니터·휴대폰·냉장고 등은 사치품이 아니다. 스펙·가격 비교가 쉬워 가격 인상에 매우 민감하다. 예산 내에서는 사지만 초과 시 바로 대안 픽.'
      : '직접 써봐야 안다. 브랜드·경험 중시. 가격이 올라도 쉽게 단념 안함.';

  const agentsDescriptions = agents
    .map((agent, i) => {
      return `[에이전트 ${i}]
이름: ${agent.name} (${agent.age}세 ${agent.sex === 'M' ? '남' : '여'}, ${agent.gen}세대, ${agent.region})
소득: ${agent.income.toLocaleString()}원 / 예산 상한: 약 ${agent.budget_limit_krw?.toLocaleString()}원
우선가치: ${dominantValueKR(agent)} (가성비 ${Math.round(agent.values.gaseong * 100)}, 가심비 ${Math.round(agent.values.gasim * 100)}, 미닝아웃 ${Math.round(agent.values.meaning * 100)}, 브랜드 ${Math.round(agent.values.brand * 100)})
카테고리 관심도: ${Math.round(productInterest(agent, product) * 100)}/100
트라우마: ${agent.trauma ? agent.trauma : '특이사항 없음'}
요약: ${agent.bio}`;
    })
    .join('\n\n');

  const priceLine = `총 ${agents.length}명의 소비자가 동시 판단합니다.
상품: ${product.emoji} ${product.name} (${goodTypeKR})
제안 가격: ${newPrice.toLocaleString()}원 / ${product.unit}`;

  const discussion = seedPost
    ? `\n\n【커뮤니티 토론 컨텍스트】\n오피니언 리더: "${seedPost}"\n${(comments ?? []).map((c) => `· ${c.agentName}: "${c.text}"`).join('\n')}\n* 에이전트들은 위 토론을 보고 의견이 바뀌거나 확고해질 수 있습니다.`
    : '';

  const systemPrompt = `당신은 ${agents.length}명의 각기 다른 한국 소비자를 시뮬레이션해야 합니다.
${goodTypeHint}
예산초과 등 한계를 철저히 지키시오. 각 소비자마다 사는지 안사는지 여부(buy)와 확신도, 이유(rationale)를 반환하세요.

${priceLine}${discussion}`;

  const batchSchema = {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: decisionSchema,
      },
    },
    required: ['results'],
    additionalProperties: false,
  };

  const completion = await openaiClient.chat.completions.create({
    model: MODEL,
    max_tokens: 3000,
    temperature: 0.6,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: agentsDescriptions },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'decision_batch',
        strict: true,
        schema: batchSchema,
      },
    },
  });

  const raw = completion.choices[0]?.message?.content ?? '{"results":[]}';
  try {
    const parsed = JSON.parse(raw);
    const results = parsed.results || [];
    return agents.map((a, i) => {
      const d = results[i];
      if (!d)
        return { buy: false, confidence: 3, rationale_cot: '오류로 판단 보류' };
      return {
        buy: Boolean(d.buy),
        confidence: Math.max(1, Math.min(5, Number(d.confidence) || 3)),
        rationale_cot: String(d.rationale_cot ?? '').slice(0, 160),
      };
    });
  } catch (e) {
    return agents.map(() => ({
      buy: false,
      confidence: 1,
      rationale_cot: '파싱 에러',
    }));
  }
}
