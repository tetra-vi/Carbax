import type { PeriodStatus, TaskStatus } from './types';

// Allowed reporting-period transitions (server-side source of truth).
const PERIOD_TRANSITIONS: Record<PeriodStatus, PeriodStatus[]> = {
  DRAFT: ['COLLECTING_DATA'],
  COLLECTING_DATA: ['PROCESSING', 'NEEDS_CORRECTION', 'READY_FOR_REVIEW'],
  PROCESSING: ['COLLECTING_DATA', 'NEEDS_CORRECTION', 'READY_FOR_REVIEW'],
  NEEDS_CORRECTION: ['COLLECTING_DATA', 'PROCESSING', 'READY_FOR_REVIEW'],
  READY_FOR_REVIEW: ['NEEDS_CORRECTION', 'COLLECTING_DATA', 'PROCESSING', 'APPROVED'],
  APPROVED: ['CLOSED', 'NEEDS_CORRECTION'],
  CLOSED: [], // reopening uses the controlled reopen workflow only
};

export function canTransitionPeriod(from: PeriodStatus, to: PeriodStatus): boolean {
  return from === to || PERIOD_TRANSITIONS[from].includes(to);
}

/** Periods that are APPROVED or CLOSED are locked: no new evidence or edits. */
export function isPeriodLocked(status: PeriodStatus): boolean {
  return status === 'APPROVED' || status === 'CLOSED';
}

const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  OPEN: ['ASSIGNED', 'REJECTED', 'RESOLVED'],
  ASSIGNED: ['IN_PROGRESS', 'WAITING_FOR_EVIDENCE', 'SUBMITTED', 'RESOLVED', 'REJECTED'],
  IN_PROGRESS: ['WAITING_FOR_EVIDENCE', 'SUBMITTED', 'RESOLVED', 'REJECTED'],
  WAITING_FOR_EVIDENCE: ['IN_PROGRESS', 'SUBMITTED', 'RESOLVED', 'REJECTED'],
  SUBMITTED: ['REVALIDATING', 'WAITING_FOR_EVIDENCE', 'RESOLVED'],
  REVALIDATING: ['RESOLVED', 'WAITING_FOR_EVIDENCE'],
  RESOLVED: ['WAITING_FOR_EVIDENCE'], // a later re-analysis can re-open the evidence need
  REJECTED: [],
};

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || TASK_TRANSITIONS[from].includes(to);
}
