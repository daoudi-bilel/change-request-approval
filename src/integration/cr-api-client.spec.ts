import { users } from '../backend/seed';
import { CrAction, CrStatus } from '../backend/cr.enums';
import { T } from '../test-helpers';
import { CrApiClient, CrClientError, CrClientErrorCode } from './cr-api-client';

describe('CrApiClient seam', () => {
	it('approves a pending change request through the service', async () => {
		const client = new CrApiClient();

		const updated = await client.approve(users.mona, 'CR-2', T);

		expect(updated.status).toBe(CrStatus.APPROVED);
		expect(updated.approvals).toEqual([{ userId: 'mona', action: CrAction.APPROVE, at: T }]);
	});

	it('rejects a blank reason before the service changes status', async () => {
		const client = new CrApiClient();

		await expect(client.reject(users.mona, 'CR-2', T, '   ')).rejects.toBeInstanceOf(CrClientError);
		const stillPending = await client.get(users.mona, 'CR-2');
		expect(stillPending.status).toBe(CrStatus.PENDING_APPROVAL);
	});

	it('translates a backend forbidden error into a client error', async () => {
		const client = new CrApiClient();

		await expect(client.approve(users.viewer, 'CR-2', T)).rejects.toMatchObject({
			name: 'CrClientError',
			code: CrClientErrorCode.FORBIDDEN,
			message: 'Cannot approve',
		});
	});

	it('surfaces a simulated network failure as a client error', async () => {
		const client = new CrApiClient();
		client.failNext = true;

		await expect(client.get(users.mona, 'CR-2')).rejects.toMatchObject({
			code: CrClientErrorCode.NETWORK,
			message: 'Network error',
		});
	});
});
