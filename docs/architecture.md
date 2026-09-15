# Local architecture and operational boundaries

## Runtime

Nyashavee is a server-backed Vinext application running on the local computer. A project-local Cloudflare D1 database is the transactional system of record. The Desktop runtime resolves a fixed local administrator identity and binds only to loopback addresses.

Each request resolves `tenant -> school -> active membership -> role` on the server. Queries and mutations derive the school from that context, scope every referenced record to the same school, validate input with Zod, and append audit events for consequential changes.

## Domain model

The database contains dedicated relational tables for identity and tenancy, enrolment, academics, attendance, finance, report cards, HR, communication, discipline, clinic, library, boarding, transport, inventory, events and audit. Operational modules do not share a generic JSON-record table.

Finance uses integer minor units, explicit ISO currency (`USD` or `ZWG`), immutable issued invoices and payments, explicit allocations, reversal records and idempotency keys. Published marks and report cards have database immutability guards. Timetables have API and database overlap guards.

The parent portal requires an administrator to link a verified identity to exactly one school profile. A role alone never grants access to a learner.

## Production boundaries

- Private files require R2, file-type/size enforcement, malware scanning and expiring download URLs. Upload controls stay disabled until that infrastructure exists.
- Email, SMS, WhatsApp and payment gateways require school-owned provider credentials. The outbox records `available` or `queued`; it never claims delivery without a provider result.
- Tax calculations and statutory payroll deductions are configuration-dependent and are not hard-coded.
- Multi-school users are resolved through a verified membership cookie. A commercial onboarding flow should add a user-facing school chooser.
- Local database backups, retention, incident response and support access are operational policies, not simulated application buttons.

## Release verification

Every release must pass migration generation/review, lint, automated permission tests, a production build, API smoke tests, lifecycle checks for every mutable domain, conflict/idempotency checks, and a local runtime health check.
