import { ReqUser } from '../backend/cr.types';

export function hasPolicy(user: ReqUser, policy: string): boolean {
	return !!user && user.policies.includes(policy);
}

const APPROVER_POLICIES = ['cr_a_u', 'cr_a_w', 'cr_a_o'];

export function canApprovePolicy(user: ReqUser): boolean {
	return APPROVER_POLICIES.some((policy) => hasPolicy(user, policy));
}

/** Reject uses the same approver policies as the service (`isApprover`). */
export function canRejectPolicy(user: ReqUser): boolean {
	return APPROVER_POLICIES.some((policy) => hasPolicy(user, policy));
}
