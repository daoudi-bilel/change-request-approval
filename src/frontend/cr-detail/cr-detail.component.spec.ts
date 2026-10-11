import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CrDetailComponent } from './cr-detail.component';
import { SessionService } from '../../session/session.service';
import { users } from '../../backend/seed';
import { ReqUser } from '../../backend/cr.types';
import { CrApiClient } from '../../integration/cr-api-client';
import { CrStatus } from '../../backend/cr.enums';

const flush = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function render(user: ReqUser, id: string, prepare?: (client: CrApiClient) => void): Promise<ComponentFixture<CrDetailComponent>> {
	TestBed.resetTestingModule();
	TestBed.configureTestingModule({
		imports: [CrDetailComponent],
		providers: [{ provide: SessionService, useValue: { user } }],
	});
	await TestBed.compileComponents();
	const fixture = TestBed.createComponent(CrDetailComponent);
	fixture.componentInstance.id = id;
	prepare?.(TestBed.inject(CrApiClient));
	fixture.detectChanges();
	await flush();
	fixture.detectChanges();
	return fixture;
}

function approveButton(fixture: ComponentFixture<CrDetailComponent>): HTMLButtonElement {
	return fixture.nativeElement.querySelector('.cr-actions__approve');
}

function statusText(fixture: ComponentFixture<CrDetailComponent>): string {
	return fixture.nativeElement.querySelector('.cr-status')?.textContent ?? '';
}

describe('CrDetailComponent', () => {
	it('loads and renders the change request title', async () => {
		const fixture = await render(users.mona, 'CR-2');
		expect(fixture.nativeElement.querySelector('.cr-detail__header h2')).not.toBeNull();
	});

	it('disables Approve for a read-only viewer on a pending CR', async () => {
		const fixture = await render(users.viewer, 'CR-2');
		expect(approveButton(fixture).disabled).toBe(true);
		expect(fixture.nativeElement.querySelector('.cr-actions__reject')).toBeNull();
	});

	it('enables Approve and Reject for an approver on a pending CR', async () => {
		const fixture = await render(users.mona, 'CR-2');
		expect(approveButton(fixture).disabled).toBe(false);
		expect(fixture.nativeElement.querySelector('.cr-actions__reject-btn').disabled).toBe(true);
	});

	it('disables Approve when the CR is not pending, even for an approver', async () => {
		const draft = await render(users.mona, 'CR-1');
		expect(statusText(draft)).toContain(CrStatus.DRAFT);
		expect(approveButton(draft).disabled).toBe(true);

		const applied = await render(users.mona, 'CR-APPLIED');
		expect(statusText(applied)).toContain(CrStatus.APPLIED);
		expect(approveButton(applied).disabled).toBe(true);
	});

	it('shows a load error and no actions when the client fails', async () => {
		const fixture = await render(users.mona, 'CR-2', (client) => {
			client.failNext = true;
		});
		expect(fixture.nativeElement.querySelector('.cr-detail__error').textContent).toContain('Network error');
		expect(approveButton(fixture)).toBeNull();
	});

	it('shows a not-found error for a change request outside the user org', async () => {
		const fixture = await render(users.bob, 'CR-2');
		expect(fixture.nativeElement.querySelector('.cr-detail__error').textContent).toContain('not found');
	});

	it('approves through the client and keeps the updated CR on screen', async () => {
		const fixture = await render(users.mona, 'CR-2');
		approveButton(fixture).click();
		fixture.detectChanges();
		await flush();
		fixture.detectChanges();

		expect(statusText(fixture)).toContain(CrStatus.APPROVED);
		expect(approveButton(fixture).disabled).toBe(true);
		expect(fixture.nativeElement.textContent).toContain('APPROVE');
	});

	it('disables actions and keeps the pending CR visible while approve is in flight', async () => {
		const fixture = await render(users.mona, 'CR-2');
		TestBed.inject(CrApiClient).latencyMs = 40;
		approveButton(fixture).click();
		fixture.detectChanges();

		expect(approveButton(fixture).disabled).toBe(true);
		expect(fixture.nativeElement.querySelector('.cr-actions__pending')).not.toBeNull();
		expect(statusText(fixture)).toContain(CrStatus.PENDING_APPROVAL);

		await flush(50);
		fixture.detectChanges();
		expect(statusText(fixture)).toContain(CrStatus.APPROVED);
		expect(fixture.nativeElement.querySelector('.cr-actions__pending')).toBeNull();
	});

	it('keeps the loaded CR and shows an error when approve fails', async () => {
		const fixture = await render(users.mona, 'CR-2');
		TestBed.inject(CrApiClient).failNext = true;
		approveButton(fixture).click();
		await flush();
		fixture.detectChanges();

		expect(fixture.nativeElement.querySelector('.cr-actions__error').textContent).toContain('Network error');
		expect(statusText(fixture)).toContain(CrStatus.PENDING_APPROVAL);
		expect(approveButton(fixture).disabled).toBe(false);
	});

	it('requires a reason before reject can proceed', async () => {
		const fixture = await render(users.mona, 'CR-2');
		fixture.componentInstance.rejectReason = '   ';
		await fixture.componentInstance.reject();
		fixture.detectChanges();

		expect(fixture.nativeElement.querySelector('.cr-actions__error').textContent).toContain('reason');
		expect(statusText(fixture)).toContain(CrStatus.PENDING_APPROVAL);
	});

	it('rejects through the client and shows the reason on the timeline', async () => {
		const fixture = await render(users.mona, 'CR-2');
		const reasonField: HTMLTextAreaElement = fixture.nativeElement.querySelector('.cr-actions__reason');
		reasonField.value = 'Price increase is too high';
		reasonField.dispatchEvent(new Event('input'));
		fixture.detectChanges();

		const rejectButton: HTMLButtonElement = fixture.nativeElement.querySelector('.cr-actions__reject-btn');
		expect(rejectButton.disabled).toBe(false);
		rejectButton.click();
		await flush();
		fixture.detectChanges();

		expect(statusText(fixture)).toContain(CrStatus.REJECTED);
		expect(fixture.nativeElement.querySelector('.cr-timeline__note').textContent).toContain('Price increase is too high');
		expect(fixture.nativeElement.querySelector('.cr-actions__reject')).toBeNull();
	});
});
