import { CrRepo } from './cr-repo';
import { Budget, ChangeRequest, LineItem, PurchaseAgreement, ReqUser } from './cr.types';
import { CrStatus, CrAction } from './cr.enums';
import { assertTransition } from './cr-state-machine';
import { computeTotals } from './cr-totals';
import { Errors } from './errors';
import { round2 } from './money.util';

/**
 * Orchestrates CR actions. `submit`, `sendForApproval`, `reject`, `returnToDraft`, `get`, and `list`
 * are provided. `approve` and `apply` enforce policy, legal transitions, budget, and audit.
 */
export class CrService {
	constructor(
		private readonly repo: CrRepo,
		private readonly agreements: Map<string, PurchaseAgreement>,
		private readonly budgets: Map<string, Budget>,
	) {}

	private hasAny(u: ReqUser, prefixes: string[]): boolean {
		return prefixes.some((p) => u.policies.includes(p));
	}
	private isUpdater(u: ReqUser) {
		return this.hasAny(u, ['cr_u_u', 'cr_u_w', 'cr_u_o']);
	}
	private isApprover(u: ReqUser) {
		return this.hasAny(u, ['cr_a_u', 'cr_a_w', 'cr_a_o']);
	}
	private isApplier(u: ReqUser) {
		return this.hasAny(u, ['cr_x_u', 'cr_x_w', 'cr_x_o']);
	}

	private getOrThrow(user: ReqUser, id: string): ChangeRequest {
		const cr = this.repo.findOne(user, id);
		if (!cr) {
			throw Errors.notFound(`CR ${id} not found`);
		}
		return cr;
	}

	private transition(cr: ChangeRequest, to: CrStatus, action: CrAction, byUserId: string, at: string, note?: string): void {
		assertTransition(cr.status, to);
		cr.status = to;
		cr.audit = [...cr.audit, { action, byUserId, at, note }];
		cr.version += 1;
	}

	private refreshTotals(cr: ChangeRequest): void {
		const agreement = this.agreements.get(cr.agreementId);
		if (!agreement) {
			throw Errors.notFound('Agreement not found');
		}
		cr.totals = computeTotals(agreement, cr);
	}

	submit(user: ReqUser, id: string, at: string): ChangeRequest {
		const cr = this.getOrThrow(user, id);
		if (!this.isUpdater(user)) throw Errors.forbidden('Cannot submit');
		this.transition(cr, CrStatus.SUBMITTED, CrAction.SUBMIT, user.id, at);
		return this.repo.save(cr);
	}

	sendForApproval(user: ReqUser, id: string, at: string): ChangeRequest {
		const cr = this.getOrThrow(user, id);
		if (!this.isUpdater(user) && !this.isApprover(user)) throw Errors.forbidden('Not allowed');
		if (cr.status === CrStatus.PENDING_APPROVAL) {
			return cr;
		}
		this.refreshTotals(cr);
		this.transition(cr, CrStatus.PENDING_APPROVAL, CrAction.SEND_FOR_APPROVAL, user.id, at);
		return this.repo.save(cr);
	}

	reject(user: ReqUser, id: string, at: string, note?: string): ChangeRequest {
		const cr = this.getOrThrow(user, id);
		if (!this.isApprover(user)) throw Errors.forbidden('Cannot reject');
		if (cr.status === CrStatus.REJECTED) {
			return cr;
		}
		this.transition(cr, CrStatus.REJECTED, CrAction.REJECT, user.id, at, note);
		return this.repo.save(cr);
	}

	returnToDraft(user: ReqUser, id: string, at: string): ChangeRequest {
		const cr = this.getOrThrow(user, id);
		if (!this.isApprover(user)) throw Errors.forbidden('Cannot return');
		this.transition(cr, CrStatus.RETURNED, CrAction.RETURN, user.id, at);
		cr.approvals = [];
		return this.repo.save(cr);
	}

	approve(user: ReqUser, id: string, at: string): ChangeRequest {
		const changeRequest = this.getOrThrow(user, id);
		if (!this.isApprover(user)) {
			throw Errors.forbidden('Cannot approve');
		}
		if (changeRequest.status === CrStatus.APPROVED) {
			return changeRequest;
		}
		this.transition(changeRequest, CrStatus.APPROVED, CrAction.APPROVE, user.id, at);
		changeRequest.approvals = [...changeRequest.approvals, { userId: user.id, action: CrAction.APPROVE, at }];
		return this.repo.save(changeRequest);
	}

	apply(user: ReqUser, id: string, at: string): ChangeRequest {
		const changeRequest = this.getOrThrow(user, id);
		if (!this.isApplier(user)) {
			throw Errors.forbidden('Cannot apply');
		}
		if (changeRequest.status === CrStatus.APPLIED) {
			return changeRequest;
		}
		assertTransition(changeRequest.status, CrStatus.APPLIED);
		this.refreshTotals(changeRequest);
		const agreement = this.agreements.get(changeRequest.agreementId);
		if (!agreement) {
			throw Errors.notFound('Agreement not found');
		}
		const budget = this.budgets.get(agreement.budgetId);
		if (!budget) {
			throw Errors.notFound('Budget not found');
		}
		const delta = changeRequest.totals.delta;
		if (delta > 0 && round2(budget.balance) < delta) {
			throw Errors.insufficientBudget();
		}
		this.adjustBudget(budget, delta);
		this.writeAgreement(agreement, changeRequest);
		this.transition(changeRequest, CrStatus.APPLIED, CrAction.APPLY, user.id, at);
		return this.repo.save(changeRequest);
	}

	/**
	 * Positive deltas book funds (balance down, booked up). Negative deltas release booked funds
	 * without driving booked below zero. A zero delta leaves the budget unchanged.
	 */
	private adjustBudget(budget: Budget, delta: number): void {
		if (delta === 0) {
			return;
		}
		if (delta > 0) {
			budget.booked = round2(budget.booked + delta);
			budget.balance = round2(budget.balance - delta);
			return;
		}
		const release = Math.min(budget.booked, Math.abs(delta));
		budget.booked = round2(budget.booked - release);
		budget.balance = round2(budget.balance + release);
	}

	private writeAgreement(agreement: PurchaseAgreement, changeRequest: ChangeRequest): void {
		const proposed = changeRequest.draftChanges.lineItems;
		if (proposed && proposed.length > 0) {
			agreement.lineItems = proposed.map((item) => this.copyLineItem(item));
		}
		agreement.total = changeRequest.totals.newTotal;
	}

	private copyLineItem(item: LineItem): LineItem {
		return {
			sku: item.sku,
			description: item.description,
			quantity: item.quantity,
			unitPrice: item.unitPrice,
		};
	}

	get(user: ReqUser, id: string): ChangeRequest {
		return this.getOrThrow(user, id);
	}

	list(user: ReqUser): ChangeRequest[] {
		return this.repo.list(user);
	}
}
