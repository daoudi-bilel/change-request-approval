# Implementation Notes

## 1. What I changed

Backend

- `assertTransition` now rejects any move that is not in `LEGAL_TRANSITIONS`, after the existing terminal-state check. `DRAFT → APPROVED` is illegal. `APPLIED`, `REJECTED`, and `CANCELLED` stay immutable.
- `CrService.approve` requires an approver policy (`cr_a_u` / `cr_a_w` / `cr_a_o`), allows only `PENDING_APPROVAL → APPROVED`, appends an approval record and an `APPROVE` audit entry, then saves. A second approve of an already-approved CR returns it unchanged.
- `CrService.apply` requires an applier policy (`cr_x_u` / `cr_x_w` / `cr_x_o`) and `APPROVED`. It recomputes totals, refuses a positive delta the budget cannot cover, then books or releases funds, writes the proposed lines onto the agreement, moves to `APPLIED`, and audits. Budget and status are left untouched when the check fails.

Frontend

- `canApprove` / `canReject` require both `PENDING_APPROVAL` and an approver policy. A read-only viewer still sees the CR, with Approve disabled and Reject hidden.
- `approve` and `reject` go through `CrApiClient`. Buttons stay disabled while the call is in flight (`Saving…`). A failure leaves the loaded CR in place and shows the message. Reject will not call the client until the reason has non-whitespace text.
- After a successful action the detail view emits `changed`, and the shell reloads the list so both panes show the new status. Changing the selected id reloads the detail.

Seam

- `CrApiClient` catches `BusinessError` and network failures and rejects with `CrClientError` (code + message). The template only reads that message. A blank reject reason is rejected at the client before the service runs.
- `buildSeed` clones agreements, budgets, and change requests so `apply` cannot mutate the shared fixture objects between tests or across client instances.

## 2. Model of the flow (UI ↔ client ↔ service)

The reviewer opens a CR. The detail component calls `CrApiClient.get`, which reads `CrService` inside the caller's org. The template renders status, totals, and timeline from that payload, and enables Approve/Reject only when status and policy both allow it.

Approve clicks `client.approve(user, id, timestamp)`. The client calls `CrService.approve`, which checks the approver policy and `assertTransition`, appends the approval and audit entry, and saves. The client resolves with the updated CR (or rejects with `CrClientError`). The component replaces its loaded state with that CR and asks the list to reload. Reject is the same path, plus a trimmed reason that the client forwards into the audit note.

Apply is service-only in this slice. The same user who can approve (`mona`, who also has `cr_x_o`) can apply afterwards. The UI does not offer Apply, so it cannot offer an action this screen does not implement.

## 3. Invariants I keep

| Invariant | How / where |
|---|---|
| Only declared transitions run | `assertTransition` in the state machine, called by every service transition |
| Terminal states never change | Terminal check runs before the legal-transition check |
| UI actions match what the service will accept | Approver policies in `permissions.ts` mirror `CrService.isApprover`; buttons also require `PENDING_APPROVAL` |
| Budget never goes negative | Apply throws `INSUFFICIENT_BUDGET` before mutating when `delta > balance` |
| Every successful state change is audited | `CrService.transition` appends the audit entry |
| Org data stays inside the org | `CrRepo.scoped` filters reads; other orgs surface as not found |
| UI does not see backend exceptions | `toClientError` inside `CrApiClient.settle` maps `BusinessError` to `CrClientError` |
| A failed or slow action does not drop the CR | Component keeps `loaded` data, sets `actionError`, and disables buttons while `submitting` |

## 4. Testing strategy

- State machine: legal `DRAFT → SUBMITTED`, illegal `DRAFT → APPROVED`, terminal `APPLIED → APPROVED`.
- Service: approve (record, audit, idempotent repeat), forbidden viewer, illegal skip, terminal, cross-org not found, apply happy path (budget + agreement + audit), apply before approval, apply without policy, insufficient budget with no mutation, exact remaining balance, negative delta release.
- Client: approve through the real service, blank reject reason does not change status, forbidden and network errors become `CrClientError`.
- Component DOM: viewer vs approver, draft vs applied, load error, cross-org error, approve success, in-flight disable, failed approve keeps `PENDING_APPROVAL`, reject blocked without a reason, reject success shows the note.

I did not add an Apply control or tests for workspace-vs-user policy scope. The scaffold treats any matching prefix as enough, and the repo already isolates orgs.

## 5. Assumptions

- Approve and reject share the approver policy set. The scope suffix (`u` / `w` / `o`) is not interpreted further; that matches the provided `isApprover` helper. Org isolation is the repo's job.
- A user may approve their own CR. Nothing in the seed or brief forbids it.
- Repeating approve on `APPROVED`, or apply on `APPLIED`, returns the current CR instead of a second audit entry. Same idea as the provided reject-when-already-rejected path.
- Positive delta increases `booked` and decreases `balance`. Delta equal to the balance is allowed (`balance` may become 0). A negative delta releases `booked` up to the amount currently booked and increases `balance` by that release. Zero delta does not touch the budget. `spent` stays as it is; apply commits funds, it does not record an invoice.
- Apply copies proposed line items onto the agreement and sets `agreement.total` to the new total, so a later CR on that agreement sees the new baseline.
- The detail screen does not expose Apply. Callers use the service directly.
- The UI generates the action timestamp (`new Date().toISOString()`) and passes it through the client. The service does not invent its own clock.
- A missing reject reason is a client validation error. The provided service method still accepts whatever note the client forwards.
- Cross-org access is "not found", not "forbidden", because the repository filters by org before the action runs.

## 6. Where I used AI

I used an AI coding assistant for the implementation and these notes, then reviewed the result against the brief and the existing error, transition, and client patterns. I can explain this code and change it live, including a new action across the same client boundary.

## 7. What I'd improve with more time

- An Apply button, shown only for `APPROVED` plus an apply policy, using the same client and in-flight/error behavior as Approve.
- Real scope checks (`u` vs `w` vs `o`) instead of "any prefix matches", shared by the service and `permissions.ts` so they cannot drift.
- Compare-and-swap on `version` so two reviewers cannot both approve a stale CR.
- A single module for policy prefixes so the service and the UI cannot drift.
- Clear the in-memory budget and agreement changes behind a small unit-of-work so a future step after the budget write cannot leave them half-applied.
