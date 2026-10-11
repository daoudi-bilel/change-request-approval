import { buildApp, T } from '../test-helpers';
import { BusinessError } from './errors';
import { CrAction, CrStatus } from './cr.enums';
import { ChangeRequest, LineItem, PurchaseAgreement } from './cr.types';

function line(sku: string, quantity: number, unitPrice: number): LineItem {
	return { sku, description: sku, quantity, unitPrice };
}

function changeRequest(overrides: Partial<ChangeRequest>): ChangeRequest {
	return {
		id: 'CR-CUSTOM',
		orgCode: 'org-alpha',
		agreementId: 'AGR-1',
		createdBy: 'alice',
		title: 'Custom',
		status: CrStatus.APPROVED,
		draftChanges: {},
		totals: { baselineTotal: 8000, newTotal: 8000, delta: 0 },
		approvals: [],
		version: 1,
		audit: [],
		...overrides,
	};
}

describe('CrService approval actions', () => {
	it('approves a pending CR, records the approver, and audits', () => {
		const { service, users } = buildApp();
		const approved = service.approve(users.mona, 'CR-2', T);

		expect(approved.status).toBe(CrStatus.APPROVED);
		expect(approved.approvals).toEqual([{ userId: 'mona', action: CrAction.APPROVE, at: T }]);
		expect(approved.audit[approved.audit.length - 1]).toMatchObject({
			action: CrAction.APPROVE,
			byUserId: 'mona',
			at: T,
		});
	});

	it('does not append a second approval when approve is repeated', () => {
		const { service, users } = buildApp();
		const first = service.approve(users.mona, 'CR-2', T);
		const second = service.approve(users.mona, 'CR-2', T);

		expect(second.status).toBe(CrStatus.APPROVED);
		expect(second.version).toBe(first.version);
		expect(second.audit.filter((entry) => entry.action === CrAction.APPROVE)).toHaveLength(1);
	});

	it('rejects approve from a read-only user', () => {
		const { service, users } = buildApp();

		expect(() => service.approve(users.viewer, 'CR-2', T)).toThrow(BusinessError);
		try {
			service.approve(users.viewer, 'CR-2', T);
		} catch (err) {
			expect(err).toBeInstanceOf(BusinessError);
			if (err instanceof BusinessError) {
				expect(err.code).toBe('FORBIDDEN');
			}
		}
	});

	it('rejects an illegal approve that skips PENDING_APPROVAL', () => {
		const { service, repo, users } = buildApp();

		expect(() => service.approve(users.mona, 'CR-1', T)).toThrow(/not allowed/i);
		expect(repo.findOne(users.mona, 'CR-1')?.status).toBe(CrStatus.DRAFT);
	});

	it('rejects approve out of a terminal state', () => {
		const { service, users } = buildApp();

		expect(() => service.approve(users.mona, 'CR-APPLIED', T)).toThrow(BusinessError);
	});

	it('hides another org from the approver', () => {
		const { service, users } = buildApp();

		expect(() => service.approve(users.bob, 'CR-2', T)).toThrow(/not found/i);
	});

	it('applies an approved CR, books a positive delta, updates the agreement, and audits', () => {
		const { service, agreements, budgets, users } = buildApp();
		service.approve(users.mona, 'CR-2', T);

		const applied = service.apply(users.mona, 'CR-2', T);

		expect(applied.status).toBe(CrStatus.APPLIED);
		expect(applied.audit[applied.audit.length - 1]).toMatchObject({ action: CrAction.APPLY, byUserId: 'mona', at: T });
		expect(budgets.get('BUD-1')).toMatchObject({ booked: 8500, balance: 9500, spent: 2000 });
		expect(agreements.get('AGR-1')?.total).toBe(8500);
	});

	it('does not book budget when apply is attempted before approval', () => {
		const { service, budgets, users } = buildApp();

		expect(() => service.apply(users.mona, 'CR-2', T)).toThrow(/not allowed/i);
		expect(budgets.get('BUD-1')).toMatchObject({ booked: 8000, balance: 10000 });
	});

	it('rejects apply from a user without an apply policy', () => {
		const { service, users } = buildApp();
		service.approve(users.mona, 'CR-2', T);

		expect(() => service.apply(users.alice, 'CR-2', T)).toThrow(BusinessError);
	});

	it('rejects apply when a positive delta exceeds the balance and leaves the budget unchanged', () => {
		const { service, repo, agreements, budgets, users } = buildApp();
		const lowAgreement: PurchaseAgreement = {
			id: 'AGR-LOW',
			orgCode: 'org-alpha',
			currency: 'USD',
			budgetId: 'BUD-LOW',
			lineItems: [line('SKU-L', 1, 50)],
			total: 50,
		};
		agreements.set(lowAgreement.id, lowAgreement);
		repo.save(
			changeRequest({
				id: 'CR-LOW',
				agreementId: 'AGR-LOW',
				title: 'Too expensive',
				draftChanges: { lineItems: [line('SKU-L', 4, 50)] },
				totals: { baselineTotal: 50, newTotal: 200, delta: 150 },
			}),
		);
		const balanceBefore = budgets.get('BUD-LOW')?.balance;

		let caught: unknown;
		try {
			service.apply(users.mona, 'CR-LOW', T);
		} catch (err) {
			caught = err;
		}

		expect(caught).toBeInstanceOf(BusinessError);
		if (caught instanceof BusinessError) {
			expect(caught.code).toBe('INSUFFICIENT_BUDGET');
		}
		expect(budgets.get('BUD-LOW')?.balance).toBe(balanceBefore);
		expect(repo.findOne(users.mona, 'CR-LOW')?.status).toBe(CrStatus.APPROVED);
	});

	it('allows apply when the delta exactly equals the remaining balance', () => {
		const { service, repo, agreements, budgets, users } = buildApp();
		const lowAgreement: PurchaseAgreement = {
			id: 'AGR-EXACT',
			orgCode: 'org-alpha',
			currency: 'USD',
			budgetId: 'BUD-LOW',
			lineItems: [line('SKU-E', 1, 50)],
			total: 50,
		};
		agreements.set(lowAgreement.id, lowAgreement);
		repo.save(
			changeRequest({
				id: 'CR-EXACT',
				agreementId: 'AGR-EXACT',
				draftChanges: { lineItems: [line('SKU-E', 3, 50)] },
				totals: { baselineTotal: 50, newTotal: 150, delta: 100 },
			}),
		);

		const applied = service.apply(users.mona, 'CR-EXACT', T);

		expect(applied.status).toBe(CrStatus.APPLIED);
		expect(budgets.get('BUD-LOW')).toMatchObject({ balance: 0, booked: 100 });
	});

	it('releases booked funds when the applied delta is negative', () => {
		const { service, repo, budgets, users } = buildApp();
		repo.save(
			changeRequest({
				id: 'CR-CREDIT',
				draftChanges: { lineItems: [line('SKU-A', 9, 500), line('SKU-B', 30, 100)] },
				totals: { baselineTotal: 8000, newTotal: 7500, delta: -500 },
			}),
		);

		const applied = service.apply(users.mona, 'CR-CREDIT', T);

		expect(applied.status).toBe(CrStatus.APPLIED);
		expect(applied.totals.delta).toBe(-500);
		expect(budgets.get('BUD-1')).toMatchObject({ booked: 7500, balance: 10500 });
	});
});
