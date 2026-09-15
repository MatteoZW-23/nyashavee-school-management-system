# Verified implementation checklist

## Identity, tenancy and security

- [x] Hosting-backed authentication and active school memberships
- [x] School-scoped reads, writes, reports and exports
- [x] Granular role permissions and resource-level teacher/portal scope
- [x] Audit logs and immutable finance/report-card records
- [x] Explicit parent/student profile linking

## Enrolment and academics

- [x] Admission review through atomic learner enrolment
- [x] Student and guardian records with multi-child links
- [x] Academic years, terms, grades, classes, subjects and teacher assignment
- [x] Attendance draft/submission registers (learners + staff)
- [x] Weighted assessments, mark entry, publication and report cards
- [x] Timetable overlap prevention

## Finance and operations

- [x] Currency-safe invoices, payments, allocations, credits, receipts and reversals
- [x] Debtor and management reporting
- [x] Staff/leave, announcements, discipline and clinic workflows
- [x] Library, boarding, transport, inventory and events lifecycles
- [x] School-wide document register with role-filtered sensitive files
- [x] Administration, school settings, users and audit viewer

## External configuration required

- [ ] Private R2 file storage and malware scanner
- [ ] School-selected email/SMS/WhatsApp providers
- [ ] School-selected online payment gateway
- [ ] Deployment-account backup and retention policy
