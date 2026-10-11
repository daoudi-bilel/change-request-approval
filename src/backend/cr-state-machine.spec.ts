import { assertTransition } from './cr-state-machine';
import { CrStatus } from './cr.enums';

/** Legal moves pass. Skips and moves out of a terminal state are rejected. */
describe('backend state machine', () => {
	it('allows the legal DRAFT -> SUBMITTED', () => {
		expect(() => assertTransition(CrStatus.DRAFT, CrStatus.SUBMITTED)).not.toThrow();
	});

	it('rejects the illegal DRAFT -> APPROVED (approval cannot be skipped)', () => {
		expect(() => assertTransition(CrStatus.DRAFT, CrStatus.APPROVED)).toThrow(/illegal|not allowed/i);
	});

	it('rejects moving out of a terminal state', () => {
		expect(() => assertTransition(CrStatus.APPLIED, CrStatus.APPROVED)).toThrow();
	});
});
