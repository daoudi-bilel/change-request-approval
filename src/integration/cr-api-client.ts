import { Injectable } from '@angular/core';
import { ChangeRequest, ReqUser } from '../backend/cr.types';
import { CrService } from '../backend/cr-service';
import { CrRepo } from '../backend/cr-repo';
import { buildSeed } from '../backend/seed';
import { BusinessError, BusinessErrorCode } from '../backend/errors';

/** UI-facing error codes. Backend BusinessError values are mapped onto these at the seam. */
export enum CrClientErrorCode {
	FORBIDDEN = 'FORBIDDEN',
	NOT_FOUND = 'NOT_FOUND',
	ILLEGAL_TRANSITION = 'ILLEGAL_TRANSITION',
	TERMINAL_STATE = 'TERMINAL_STATE',
	INSUFFICIENT_BUDGET = 'INSUFFICIENT_BUDGET',
	VALIDATION = 'VALIDATION',
	NETWORK = 'NETWORK',
	UNKNOWN = 'UNKNOWN',
}

const CLIENT_CODE_BY_BUSINESS_CODE: Record<BusinessErrorCode, CrClientErrorCode> = {
	FORBIDDEN: CrClientErrorCode.FORBIDDEN,
	NOT_FOUND: CrClientErrorCode.NOT_FOUND,
	ILLEGAL_TRANSITION: CrClientErrorCode.ILLEGAL_TRANSITION,
	TERMINAL_STATE: CrClientErrorCode.TERMINAL_STATE,
	INSUFFICIENT_BUDGET: CrClientErrorCode.INSUFFICIENT_BUDGET,
	VALIDATION: CrClientErrorCode.VALIDATION,
};

/** Error shape the template can render. The UI should not depend on backend exception types. */
export class CrClientError extends Error {
	readonly isClientError = true;

	constructor(readonly code: CrClientErrorCode, message: string) {
		super(message);
		this.name = 'CrClientError';
	}
}

function toClientError(err: unknown): CrClientError {
	if (err instanceof CrClientError) {
		return err;
	}
	if (err instanceof BusinessError) {
		return new CrClientError(CLIENT_CODE_BY_BUSINESS_CODE[err.code], err.message);
	}
	if (err instanceof Error && err.message) {
		return new CrClientError(CrClientErrorCode.UNKNOWN, err.message);
	}
	return new CrClientError(CrClientErrorCode.UNKNOWN, 'Something went wrong');
}

export const rejectReasonRequiredMessage = 'A reason is required to reject this change request.';

/**
 * The API/UI boundary. The Angular UI talks to this async client; the client calls the in-process
 * backend `CrService` (built over the seeded repo). This stands in for an HTTP layer — same contract,
 * no network. Business errors are translated into CrClientError before they reach the UI.
 *
 * `latencyMs`/`failNext` let the UI exercise loading and error handling.
 */
@Injectable({ providedIn: 'root' })
export class CrApiClient {
	latencyMs = 0;
	failNext = false;
	private readonly service: CrService;

	constructor() {
		const seed = buildSeed();
		const repo = new CrRepo();
		repo.seed(seed.changeRequests);
		this.service = new CrService(repo, seed.agreements, seed.budgets);
	}

	private settle<T>(produce: () => T): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			setTimeout(() => {
				if (this.failNext) {
					this.failNext = false;
					reject(new CrClientError(CrClientErrorCode.NETWORK, 'Network error'));
					return;
				}
				try {
					resolve(produce());
				} catch (err) {
					reject(toClientError(err));
				}
			}, this.latencyMs);
		});
	}

	list(user: ReqUser): Promise<ChangeRequest[]> {
		return this.settle(() => this.service.list(user));
	}
	get(user: ReqUser, id: string): Promise<ChangeRequest> {
		return this.settle(() => this.service.get(user, id));
	}
	approve(user: ReqUser, id: string, at: string): Promise<ChangeRequest> {
		return this.settle(() => this.service.approve(user, id, at));
	}
	reject(user: ReqUser, id: string, at: string, note: string): Promise<ChangeRequest> {
		const reason = note.trim();
		if (!reason) {
			return Promise.reject(new CrClientError(CrClientErrorCode.VALIDATION, rejectReasonRequiredMessage));
		}
		return this.settle(() => this.service.reject(user, id, at, reason));
	}
}
