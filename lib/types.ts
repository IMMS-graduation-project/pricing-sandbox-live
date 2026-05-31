export type Generation = 'Z' | 'M' | 'X' | 'Boomer';
export type Sex = 'M' | 'F';
export type HouseholdCode =
  | 'single'
  | 'parents'
  | 'dink'
  | 'family'
  | 'senior_couple';
export type GoodType = 'search' | 'experience';

export interface PersonaValues {
  gaseong: number;
  gasim: number;
  meaning: number;
  brand: number;
}

export interface PersonaLifestyle {
  monitor_interest: number;
  cosmetics_interest: number;
}

export interface Persona {
  id: string;
  name: string;
  nameEn: string;
  archetype: string;
  gen: Generation;
  age: number;
  sex: Sex;
  household: string;
  householdCode: HouseholdCode;
  region: string;
  occupation: string;
  income: number;
  savings_rate: number;
  debt: string;
  values: PersonaValues;
  lifestyle: PersonaLifestyle;
  bio: string;
  sources: string;
}

export interface Product {
  id: string;
  name: string;
  emoji: string;
  goodType: GoodType;
  basePrice: number;
  unit: string;
  priceSource: string;
  elasticityPrior: string;
}

export interface CustomProduct {
  id: 'custom';
  name: string;
  emoji: string;
  goodType: GoodType;
  basePrice: number;
  unit: string;
  priceSource: string;
  elasticityPrior: string;
}

export type ActiveProduct = Product | CustomProduct;

export interface Decision {
  buy: boolean;
  confidence: number;
  rationale_cot: string;
}

export interface Agent {
  agent_id: string;
  archetypeId: string;
  name: string;
  nameEn: string;
  archetype: string;
  gen: Generation;
  age: number;
  sex: Sex;
  household: string;
  householdCode: HouseholdCode;
  region: string;
  occupation: string;
  income: number;
  savings_rate: number;
  debt: string;
  values: PersonaValues;
  lifestyle: PersonaLifestyle;
  bio: string;
  sources: string;

  // Layer 1 - Budget Constraint
  budget_limit_krw?: number;

  // Layer 3 - History & Constraints
  trauma?: string;
  search_capacity?: number; // 0~1
  emergency_need?: number; // 0~1

  // Layer 4 - Macro & Vibe
  macro_context?: string;
  vibe_tone?: string;
}

export interface AgentDecision {
  agent_id: string;
  agent_name: string;
  baselineDecision: Decision;
  preDiscussionDecision: Decision;
  postDiscussionDecision?: Decision;
  flipped?: boolean;
}

export interface DiscussionThread {
  leader: { agent_id: string; seedPost: string };
  comments: { agent_id: string; text: string }[];
}

export interface SimulateRequest {
  product: ActiveProduct;
  deltaPct: number;
  discussion: boolean;
  populationSize: number;
}

export interface SimulateResponse {
  product: ActiveProduct;
  deltaPct: number;
  discussion: boolean;
  decisions: AgentDecision[];
  thread?: DiscussionThread;
  metrics: {
    Q0: number; // buyRateBase
    Q1: number; // buyRatePre
    Q2: number; // buyRatePost
    deltaQ1: number;
    deltaQ2: number;
    elasticity_sim: number;
    elasticity_post: number;
    wom_m: number;
    mcnemar: { b: number; c: number; chi2: number; significant: boolean };
    flipCount: number;
    cohort: {
      gen: Record<string, { n: number; Q0: number; Q1: number; Q2: number }>;
      val: Record<string, { n: number; Q0: number; Q1: number; Q2: number }>;
      inc: Record<string, { n: number; Q0: number; Q1: number; Q2: number }>;
      house: Record<string, { n: number; Q0: number; Q1: number; Q2: number }>;
    };
  };
  populationSize: number;
}
