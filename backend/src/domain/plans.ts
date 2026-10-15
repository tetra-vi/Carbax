import type { PlanId } from './types';

// Proposed SaaS plans. Prices are hypotheses to validate in pilots, not confirmed market prices.
export type Feature = 'CARBONOPS' | 'CARBONTWIN' | 'INTELLIGENCE' | 'BUYER_SHARING' | 'VOICE' | 'ADVANCED_REVIEW';

export interface Plan {
  id: PlanId;
  name: string;
  proposedMonthlyPriceUsd: number | null;
  maxFacilities: number;
  maxUsers: number;
  documentsPerMonth: number;
  aiCallsPerMonth: number;
  speechSecondsPerMonth: number;
  features: Feature[];
}

const ALL: Feature[] = ['CARBONOPS', 'CARBONTWIN', 'INTELLIGENCE', 'BUYER_SHARING', 'VOICE', 'ADVANCED_REVIEW'];

export const PLANS: Record<PlanId, Plan> = {
  TRIAL: {
    id: 'TRIAL', name: 'Free Trial', proposedMonthlyPriceUsd: 0,
    maxFacilities: 1, maxUsers: 5, documentsPerMonth: 60, aiCallsPerMonth: 400, speechSecondsPerMonth: 600,
    features: ALL, // full feature preview with low limits
  },
  STARTER: {
    id: 'STARTER', name: 'Starter', proposedMonthlyPriceUsd: 59,
    maxFacilities: 1, maxUsers: 3, documentsPerMonth: 40, aiCallsPerMonth: 300, speechSecondsPerMonth: 0,
    features: ['CARBONOPS', 'INTELLIGENCE'],
  },
  GROWTH: {
    id: 'GROWTH', name: 'Growth', proposedMonthlyPriceUsd: 179,
    maxFacilities: 2, maxUsers: 10, documentsPerMonth: 200, aiCallsPerMonth: 1500, speechSecondsPerMonth: 1800,
    features: ['CARBONOPS', 'CARBONTWIN', 'INTELLIGENCE', 'VOICE'],
  },
  BUSINESS: {
    id: 'BUSINESS', name: 'Business', proposedMonthlyPriceUsd: 449,
    maxFacilities: 10, maxUsers: 50, documentsPerMonth: 1000, aiCallsPerMonth: 8000, speechSecondsPerMonth: 7200,
    features: ALL,
  },
  BUYER_NETWORK: {
    id: 'BUYER_NETWORK', name: 'Buyer Network', proposedMonthlyPriceUsd: null,
    maxFacilities: 100, maxUsers: 200, documentsPerMonth: 10000, aiCallsPerMonth: 50000, speechSecondsPerMonth: 20000,
    features: ALL,
  },
};

export const TRIAL_DAYS = 30;
