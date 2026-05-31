import type { Persona, Agent } from './types';

function seededRand(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

const jit = (r: number, mag: number) => (r - 0.5) * 2 * mag;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export interface PersonaInstance {
  archetype: Persona;
  avatarSeed: string;
  instanceIndex: number;
  label: string;
  jitteredIncome: number;
  jitteredLifestyle: { monitor_interest: number; cosmetics_interest: number };
}

/**
 * Display-only instances for the Persona Library UI — one card per archetype.
 */
export function makeInstances(personas: Persona[]): PersonaInstance[] {
  return personas.map((p) => {
    const tag = `${p.id}-i1`;
    const r1 = seededRand(tag + ':income');
    const r2 = seededRand(tag + ':mon');
    const r3 = seededRand(tag + ':cos');
    return {
      archetype: p,
      avatarSeed: tag,
      instanceIndex: 1,
      label: '',
      jitteredIncome: Math.max(0, Math.round(p.income * (1 + jit(r1, 0.1)))),
      jitteredLifestyle: {
        monitor_interest: clamp01(p.lifestyle.monitor_interest + jit(r2, 0.05)),
        cosmetics_interest: clamp01(p.lifestyle.cosmetics_interest + jit(r3, 0.05)),
      },
    };
  });
}

/** Avatar seed needs a stable persona-shaped value that varies between instances. */
export function avatarPersona(instance: PersonaInstance): Persona {
  return { ...instance.archetype, id: instance.avatarSeed };
}

/**
 * Generate N unique agents based on the 16 archetypes for actual simulation.
 */
const GEN_AGE_RANGE: Record<string, [number, number]> = {
  Z: [19, 28],
  M: [28, 44],
  X: [44, 60],
  Boomer: [58, 75],
};

export function generatePopulationAgents(
  N: number,
  personas: Persona[],
): Agent[] {
  const agents: Agent[] = [];

  for (let i = 0; i < N; i++) {
    const p = personas[i % personas.length];
    const agent_id = `agent-${p.id}-${i}`;

    // Age varies within the generation's realistic range so each agent is distinct
    const [ageMin, ageMax] = GEN_AGE_RANGE[p.gen] ?? [p.age, p.age];
    const age = Math.round(ageMin + seededRand(agent_id + ':age') * (ageMax - ageMin));
    const r1 = seededRand(agent_id + ':income');
    const r2 = seededRand(agent_id + ':mon');
    const r3 = seededRand(agent_id + ':cos');

    // Values randomization
    const vr1 = seededRand(agent_id + ':val1');
    const vr2 = seededRand(agent_id + ':val2');

    // Layer 1 - Budget: single-purchase budget using ~1-4 months income (realistic for electronics/cosmetics).
    // Previous 5-15% of monthly income was too low — agents couldn't afford even a 300K monitor.
    const budgetPct = 1.0 + seededRand(agent_id + ':budget') * 3.0;
    const budget_limit_krw = Math.round(p.income * budgetPct);

    // Layer 3 - History & Constraints
    const traumaRand = seededRand(agent_id + ':trauma');
    const hasTrauma = traumaRand > 0.7; // 30% chance
    const trauma = hasTrauma
      ? seededRand(agent_id + ':tType') > 0.5
        ? '저가품 부작용 경험(품질 불신)'
        : '불량 A/S 경험(대기업 브랜드 선호)'
      : undefined;

    const isBusy =
      p.occupation.includes('직장인') || p.household.includes('자녀');
    const search_capacity = isBusy
      ? seededRand(agent_id + ':search_cap') * 0.4
      : 0.6 + seededRand(agent_id + ':search_cap') * 0.4;
    const emergency_need = seededRand(agent_id + ':urgency'); // 0~1

    // Generate distinct fake names instead of repeating base persona name
    const firstNamesF = [
      '지민',
      '서윤',
      '서연',
      '민서',
      '지유',
      '하윤',
      '지우',
      '수아',
      '은서',
      '다은',
      '유진',
      '수민',
      '지원',
      '채원',
      '예진',
      '하은',
      '예림',
      '유나',
      '소윤',
      '민지',
      '윤아',
      '윤서',
      '가은',
      '수빈',
    ];
    const firstNamesM = [
      '민준',
      '서준',
      '도윤',
      '예준',
      '시우',
      '하준',
      '지호',
      '주원',
      '건우',
      '우진',
      '지훈',
      '선우',
      '서진',
      '연우',
      '준우',
      '현우',
      '승우',
      '승현',
      '수현',
      '도현',
      '준서',
      '동현',
      '성민',
      '준호',
    ];
    const lastNames = [
      '김',
      '이',
      '박',
      '최',
      '정',
      '강',
      '조',
      '윤',
      '장',
      '임',
      '한',
      '오',
      '서',
      '신',
      '권',
      '황',
      '안',
      '송',
      '전',
      '홍',
    ];

    // Pick based on deterministic seed
    const idxFirstName = Math.floor(
      seededRand(agent_id + ':firstname') *
        (p.sex === 'F' ? firstNamesF.length : firstNamesM.length),
    );
    const idxLastName = Math.floor(
      seededRand(agent_id + ':lastname') * lastNames.length,
    );
    const fnameList = p.sex === 'F' ? firstNamesF : firstNamesM;
    const generatedName = lastNames[idxLastName] + fnameList[idxFirstName];

    // Layer 4 - Macro & Vibe
    const macro_context =
      '물가 상승 및 금리 인상으로 실질 가용 자금이 축소된 체감 경제 상황 (소비심리 위축)';
    const vibeRand = seededRand(agent_id + ':vibe');
    let vibe_tone = '일반적인 인터넷 커뮤니티 말투';
    if (p.gen === 'Z' && p.sex === 'F')
      vibe_tone = '인스타그램/X(트위터) 트렌디한 말투 (코덕체)';
    else if (p.gen === 'M' && p.sex === 'M')
      vibe_tone = '퀘이사존/루리웹 등 IT 하드웨어 커뮤니티 말투 (스펙 위주)';
    else if (p.sex === 'F' && p.householdCode === 'family')
      vibe_tone = '맘카페 화법 (가성비, 아이 우선)';
    else if (p.gen === 'X' || p.gen === 'Boomer')
      vibe_tone = '네이버 밴드/카카오스토리 아재/줌마 말투';

    agents.push({
      ...p,
      name: generatedName,
      agent_id,
      archetypeId: p.id,
      age,
      income: Math.max(0, Math.round(p.income * (1 + jit(r1, 0.2)))), // ±20% income variation
      budget_limit_krw,
      trauma,
      search_capacity,
      emergency_need,
      macro_context,
      vibe_tone,
      values: {
        gaseong: clamp01(p.values.gaseong + jit(vr1, 0.15)),
        gasim: clamp01(p.values.gasim + jit(vr2, 0.15)),
        meaning: clamp01(p.values.meaning + jit(vr1, -0.1)),
        brand: clamp01(p.values.brand + jit(vr2, -0.1)),
      },
      lifestyle: {
        monitor_interest: clamp01(p.lifestyle.monitor_interest + jit(r2, 0.15)), // ±15% interest variation
        cosmetics_interest: clamp01(
          p.lifestyle.cosmetics_interest + jit(r3, 0.15),
        ),
      },
    });
  }

  return agents;
}
