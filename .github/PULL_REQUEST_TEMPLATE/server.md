<!--
Server-track template: for the multi-user, university-wide version (Roadmap Tier 5).
Open with ?template=server.md. Assumes the shape described in ROADMAP.md: Django + DRF,
PostgreSQL, facilities as tenants, row-level permissions enforced in the API, a job runner
for mail. Adjust the checklist once the stack is fixed; the rules it encodes should not change.
Delete any block that does not apply. "N/A" is a valid answer; silence is not.
-->

## Description
<!-- What changes for a facility, a lab, or finance, and why. One paragraph. -->

## Related Issue / Roadmap Item
Closes #
Roadmap: 5.__

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / chore
- [ ] Documentation only
- [ ] Database migration (schema or data)
- [ ] API contract change (new/removed endpoint, field, status code, or permission)
- [ ] Breaking change for the local app's backup import (5.12)
- [ ] Deployment / configuration change (env vars, systemd, Nginx, worker)

## Data Touched
<!-- Which of these does this PR read or write? Each one triggers a block below. -->
- [ ] Money (rates, tiers, cost snapshots, cancellation retention, invoices)
- [ ] Bookings / reservations / approval state
- [ ] Permissions, roles, sharing, or tenant boundaries
- [ ] Personal data (people, labs, email, SSO claims)
- [ ] Audit log
- [ ] None of the above

## How Has This Been Tested?
<!-- Paste the exact commands. Time-dependent logic runs in the facility's timezone; test under Asia/Jerusalem, not UTC. -->
```bash
# e.g. TZ='Asia/Jerusalem' python manage.py test
```
- [ ] Unit tests pass
- [ ] Integration tests against a real PostgreSQL pass (not SQLite — exclusion constraints and lock behaviour differ)
- [ ] Migration applied forwards on a copy of a realistic database, and reversed
- [ ] Manually exercised through the web client, as each role this PR affects (staff, PI, lab member, auditor, university admin)
- [ ] Tested only on synthetic fixtures (demo dataset / generated bookings), never on a derived copy of real facility data

## Checklist — pick the blocks that apply

**Money** (rules ported from the local app, not rewritten)
- [ ] One-hour staff floor, tier pricing, category policies and cancellation retention give the same result as the local app; seed booking #1 still produces 490 / 546.25 / 589.95
- [ ] Cost snapshots are frozen at save time and never recomputed; a rate change affects future bookings only
- [ ] Cost fields serialise only through their own allow-list (facility staff, owning PI, PI-designated members, assigned auditors), regardless of how the reader can see the record
- [ ] Rates, tiers and policies never leave facility staff in any response, including list endpoints, search results, error messages and logs
- [ ] Reports, invoice export (5.10) and contribution records (5.13) read from the same aggregation code; no second copy
- [ ] Every write to a booking, cost, cancellation decision or permission produces an audit entry with actor, time and before/after values

**Bookings / concurrency**
- [ ] Conflict, gap, duration and advance-notice rules run inside one transaction that locks instrument and staff rows in canonical order (type, then ascending id), with a lock timeout and one retry
- [ ] `reservations` row written in the same transaction; exclusion constraint covers every status that holds capacity (confirmed and pending)
- [ ] Concurrency test: two overlapping requests submitted together, exactly one succeeds
- [ ] Approval and decline (5.7) re-run the full rule set; expiry releases the slot and writes an audit entry
- [ ] Has-started and advance-notice checks evaluate in the facility's timezone, not the server's or UTC
- [ ] Cancelled bookings free the slot; retained charges still count (same rule as the local app)

**Permissions / tenancy**
- [ ] Every new endpoint and every new field checked server-side; nothing relies on the client hiding it
- [ ] Ownership resolution follows the one order: project's lab, else the booking's group, else the facility
- [ ] Facility A cannot read, list, count or search facility B's instruments, rates, income or staff; test added for the negative case
- [ ] Records with no project and no group are facility-owned and visible to facility staff and the people on them
- [ ] Per-object sharing can widen read/write on a project or booking but never exposes cost fields
- [ ] Role changes and sharing changes are audit-logged

**Personal data / auth**
- [ ] No new personal data stored without a stated purpose in the PR description
- [ ] Auth backend chain unchanged, or the change keeps local / LDAP / SAML-OIDC as configuration rather than code
- [ ] Tokens (iCal feeds, API keys) are per-user, revocable, and not logged
- [ ] Nothing in this PR sends mail inside a web request; mail goes through the job runner

**Migration / import path (5.12)**
- [ ] Importer still accepts the current local-app backup format, including embedded attachment blobs
- [ ] Parity check after import: totals, discounts and ownership match the local app's reports on the same fixture
- [ ] Mismatches and PI-less projects land on the review list rather than failing silently or guessing

**Deployment**
- [ ] New environment variables documented with defaults; secrets never committed
- [ ] Migration is safe to run on a live database (no long table lock without a stated maintenance window)
- [ ] Worker / scheduler changes are idempotent; a job that runs twice does not send twice or charge twice
- [ ] Rollback path stated

**Docs**
- [ ] API change reflected in the API reference and, if user-visible, in prose written for facility managers, PIs or finance staff (no schema, endpoint, or join-table language)
- [ ] Review threads addressed or answered

## Screenshots (UI changes)
<!-- Before / after, per role where the view differs. -->
