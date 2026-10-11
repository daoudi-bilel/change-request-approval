import { Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CrApiClient, rejectReasonRequiredMessage } from '../../integration/cr-api-client';
import { SessionService } from '../../session/session.service';
import { ChangeRequest, TimelineEntry } from '../../backend/cr.types';
import { CrStatus } from '../../backend/cr.enums';
import { idle, loading, ViewState } from '../view-state';
import { canApprovePolicy, canRejectPolicy } from '../permissions';

/**
 * Change Request DETAIL page. Loads a CR through CrApiClient and renders status, totals, timeline,
 * and Approve/Reject actions that respect both status and the current user's policies.
 */
@Component({
	selector: 'app-cr-detail',
	standalone: true,
	imports: [CommonModule],
	templateUrl: './cr-detail.component.html',
})
export class CrDetailComponent implements OnInit, OnChanges {
	@Input() id!: string;
	@Output() changed = new EventEmitter<ChangeRequest>();

	state: ViewState<ChangeRequest> = idle();
	submitting = false;
	actionError?: string;
	rejectReason = '';

	private loadGeneration = 0;

	constructor(private readonly client: CrApiClient, private readonly session: SessionService) {}

	ngOnInit(): void {
		void this.load();
	}

	ngOnChanges(changes: SimpleChanges): void {
		if (!changes['id'] || changes['id'].firstChange) {
			return;
		}
		this.rejectReason = '';
		this.actionError = undefined;
		void this.load();
	}

	async load(): Promise<void> {
		const generation = ++this.loadGeneration;
		this.submitting = false;
		this.state = loading();
		this.actionError = undefined;
		try {
			const detail = await this.client.get(this.session.user, this.id);
			if (generation !== this.loadGeneration) {
				return;
			}
			this.state = { status: 'loaded', data: detail };
		} catch (err) {
			if (generation !== this.loadGeneration) {
				return;
			}
			this.state = { status: 'error', data: null, error: this.readError(err) };
		}
	}

	get detail(): ChangeRequest | null {
		return this.state.data;
	}

	/** Approval history for display (read-only). */
	get timeline(): TimelineEntry[] {
		return this.detail?.audit ?? [];
	}

	onReasonInput(value: string): void {
		this.rejectReason = value;
	}

	/** Approve is offered only for a pending CR when the user holds an approver policy. */
	get canApprove(): boolean {
		const changeRequest = this.detail;
		if (!changeRequest) {
			return false;
		}
		if (changeRequest.status !== CrStatus.PENDING_APPROVAL) {
			return false;
		}
		if (!canApprovePolicy(this.session.user)) {
			return false;
		}
		return true;
	}

	/** Reject uses the same status and approver-policy gate as approve. */
	get canReject(): boolean {
		const changeRequest = this.detail;
		if (!changeRequest) {
			return false;
		}
		if (changeRequest.status !== CrStatus.PENDING_APPROVAL) {
			return false;
		}
		if (!canRejectPolicy(this.session.user)) {
			return false;
		}
		return true;
	}

	async approve(): Promise<void> {
		if (!this.canApprove || this.submitting) {
			return;
		}
		const changeRequest = this.detail;
		if (!changeRequest) {
			return;
		}
		const generation = this.loadGeneration;
		this.submitting = true;
		this.actionError = undefined;
		try {
			const updated = await this.client.approve(this.session.user, changeRequest.id, new Date().toISOString());
			if (generation !== this.loadGeneration) {
				return;
			}
			this.state = { status: 'loaded', data: updated };
			this.changed.emit(updated);
		} catch (err) {
			if (generation !== this.loadGeneration) {
				return;
			}
			this.actionError = this.readError(err);
		} finally {
			if (generation === this.loadGeneration) {
				this.submitting = false;
			}
		}
	}

	async reject(): Promise<void> {
		if (!this.canReject || this.submitting) {
			return;
		}
		const changeRequest = this.detail;
		if (!changeRequest) {
			return;
		}
		const reason = this.rejectReason.trim();
		if (!reason) {
			this.actionError = rejectReasonRequiredMessage;
			return;
		}
		const generation = this.loadGeneration;
		this.submitting = true;
		this.actionError = undefined;
		try {
			const updated = await this.client.reject(this.session.user, changeRequest.id, new Date().toISOString(), reason);
			if (generation !== this.loadGeneration) {
				return;
			}
			this.rejectReason = '';
			this.state = { status: 'loaded', data: updated };
			this.changed.emit(updated);
		} catch (err) {
			if (generation !== this.loadGeneration) {
				return;
			}
			this.actionError = this.readError(err);
		} finally {
			if (generation === this.loadGeneration) {
				this.submitting = false;
			}
		}
	}

	private readError(err: unknown): string {
		if (err instanceof Error && err.message) {
			return err.message;
		}
		return 'Something went wrong';
	}
}
