import { CrStatus, isTerminal } from './cr.enums';
import { Errors } from './errors';

/** Legal transitions for the CR state machine. */
export const LEGAL_TRANSITIONS: Partial<Record<CrStatus, CrStatus[]>> = {
	[CrStatus.DRAFT]: [CrStatus.SUBMITTED, CrStatus.CANCELLED],
	[CrStatus.SUBMITTED]: [CrStatus.PENDING_APPROVAL, CrStatus.CANCELLED],
	[CrStatus.PENDING_APPROVAL]: [CrStatus.APPROVED, CrStatus.RETURNED, CrStatus.REJECTED],
	[CrStatus.APPROVED]: [CrStatus.APPLIED],
	[CrStatus.RETURNED]: [CrStatus.DRAFT],
};

export function canTransition(from: CrStatus, to: CrStatus): boolean {
	return (LEGAL_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Throw a BusinessError if the transition from->to is not allowed.
 * Terminal states are immutable. Every other move must be listed in LEGAL_TRANSITIONS,
 * so a request cannot skip approval (for example DRAFT -> APPROVED).
 */
export function assertTransition(from: CrStatus, to: CrStatus): void {
	if (isTerminal(from)) {
		throw Errors.terminal(`Cannot move a ${from} change request to ${to}`);
	}
	if (!canTransition(from, to)) {
		throw Errors.illegalTransition(`Illegal transition from ${from} to ${to} is not allowed`);
	}
}
