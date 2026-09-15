# Role & permission matrix

Generated from `lib/permissions.ts` — the single source of truth. Every API route re-checks these server-side.

| Permission | super_admin | school_admin | headmaster | deputy_head | bursar | admissions_officer | teacher | class_teacher | hod | librarian | boarding_staff | transport_staff | clinic_staff | it_admin | parent |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `*` | x |   |   |   |   |   |   |   |   |   |   |   |   |   |   |
| `academic-years.manage` | x | x |   |   |   |   |   |   |   |   |   |   |   |   |   |
| `academics.manage` | x | x | x | x |   |   |   |   | x |   |   |   |   |   |   |
| `academics.view` | x | x | x | x |   |   | x | x | x |   |   |   |   |   |   |
| `activities.manage` | x | x | x | x |   |   |   |   | x |   |   |   |   |   |   |
| `activities.view` | x | x | x | x |   |   | x | x | x | x | x | x |   |   |   |
| `admissions.admit` | x | x | x | x |   | x |   |   |   |   |   |   |   |   |   |
| `admissions.manage` | x | x | x | x |   | x |   |   |   |   |   |   |   |   |   |
| `admissions.view` | x | x | x | x |   | x |   |   |   |   |   |   |   |   |   |
| `assessments.manage` | x | x | x | x |   |   | x |   | x |   |   |   |   |   |   |
| `assessments.view` | x | x | x | x |   |   | x | x | x |   |   |   |   |   |   |
| `assignments.manage` | x | x | x | x |   |   | x | x | x |   |   |   |   |   |   |
| `attendance.correct` | x | x | x | x |   |   |   |   |   |   |   |   |   |   |   |
| `attendance.edit-draft` | x | x | x | x |   |   | x | x |   |   |   |   |   |   |   |
| `attendance.export` | x | x | x | x |   |   |   |   |   |   |   |   |   |   |   |
| `attendance.lock` | x | x | x | x |   |   |   |   |   |   |   |   |   |   |   |
| `attendance.manage-settings` | x | x | x | x |   |   |   |   |   |   |   |   |   |   |   |
| `attendance.submit` | x | x | x | x |   |   | x | x |   |   |   |   |   |   |   |
| `attendance.take` | x | x | x | x |   |   | x | x |   |   |   |   |   |   |   |
| `attendance.unlock` | x | x | x | x |   |   |   |   |   |   |   |   |   |   |   |
| `attendance.view` | x | x | x | x |   |   | x | x | x |   | x |   |   |   |   |
| `attendance.view-reports` | x | x | x | x |   |   |   |   |   |   |   |   |   |   |   |
| `audit.view` | x | x | x | x | x |   |   |   |   |   |   |   |   | x |   |
| `boarding.manage` | x | x | x |   |   |   |   |   |   |   | x |   |   |   |   |
| `boarding.view` | x | x | x |   |   |   |   |   |   |   | x |   |   |   |   |
| `classes.manage` | x | x |   |   |   |   |   |   |   |   |   |   |   |   |   |
| `classes.view` | x | x | x | x | x | x | x | x | x |   |   |   |   |   |   |
| `clinic.manage` | x | x |   |   |   |   |   |   |   |   |   |   | x |   |   |
| `clinic.view` | x | x | x |   |   |   |   |   |   |   | x |   | x |   |   |
| `communication.manage` | x | x | x | x |   |   |   |   |   |   |   |   |   |   |   |
| `communication.view` | x | x | x | x |   |   | x | x | x | x |   |   |   |   |   |
| `curriculum.manage` | x | x | x | x |   |   | x | x | x |   |   |   |   |   |   |
| `discipline.manage` | x | x | x | x |   |   | x | x |   |   | x |   |   |   |   |
| `discipline.view` | x | x | x | x |   |   | x | x |   |   | x |   |   |   |   |
| `documents.upload` | x | x | x |   |   | x |   |   |   |   |   |   |   |   |   |
| `documents.view` | x | x | x |   |   | x |   |   |   |   |   |   |   |   |   |
| `events.manage` | x | x | x | x |   |   |   |   |   |   |   |   |   |   |   |
| `events.view` | x | x | x | x |   |   | x | x |   |   | x | x |   |   |   |
| `finance.allocate` | x | x |   |   | x |   |   |   |   |   |   |   |   |   |   |
| `finance.invoice` | x | x |   |   | x |   |   |   |   |   |   |   |   |   |   |
| `finance.payment` | x | x |   |   | x |   |   |   |   |   |   |   |   |   |   |
| `finance.report` | x | x | x |   | x |   |   |   |   |   |   |   |   |   |   |
| `finance.reverse` | x | x |   |   | x |   |   |   |   |   |   |   |   |   |   |
| `finance.view` | x | x | x |   | x |   |   |   |   |   |   |   |   |   |   |
| `guardians.create` | x | x | x | x |   | x |   |   |   |   |   |   |   |   |   |
| `guardians.update` | x | x | x | x |   | x |   |   |   |   |   |   |   |   |   |
| `guardians.view` | x | x | x | x | x | x |   | x |   |   | x | x | x |   |   |
| `health.manage` | x | x |   |   |   |   |   |   |   |   |   |   | x |   |   |
| `health.view` | x | x | x |   |   |   |   |   |   |   |   |   | x |   |   |
| `inventory.manage` | x | x | x |   | x |   |   |   |   |   |   |   |   |   |   |
| `inventory.view` | x | x | x |   | x |   |   |   |   |   |   |   |   |   |   |
| `library.manage` | x | x | x |   |   |   |   |   |   | x |   |   |   |   |   |
| `library.view` | x | x | x |   |   |   |   |   |   | x |   |   |   |   |   |
| `marks.enter` | x | x | x | x |   |   | x | x | x |   |   |   |   |   |   |
| `marks.moderate` | x | x | x | x |   |   |   |   | x |   |   |   |   |   |   |
| `memberships.manage` | x | x |   |   |   |   |   |   |   |   |   |   |   |   |   |
| `payroll.manage` | x | x |   |   | x |   |   |   |   |   |   |   |   |   |   |
| `payroll.view` | x | x |   |   | x |   |   |   |   |   |   |   |   |   |   |
| `pickups.manage` | x | x | x | x |   | x |   | x |   |   |   |   |   |   |   |
| `pickups.view` | x | x | x | x |   | x | x | x | x |   | x |   |   |   |   |
| `portal.parent` | x |   |   |   |   |   |   |   |   |   |   |   |   |   | x |
| `reports.comment` | x | x | x | x |   |   |   | x | x |   |   |   |   |   |   |
| `reports.generate` | x | x | x | x |   |   |   | x | x |   |   |   |   |   |   |
| `reports.publish` | x | x | x | x |   |   |   |   |   |   |   |   |   |   |   |
| `reports.view` | x | x | x | x |   |   | x | x | x |   |   |   |   |   |   |
| `roles.assign` | x | x |   |   |   |   |   |   |   |   |   |   |   |   |   |
| `safeguarding.manage` | x | x | x |   |   |   |   |   |   |   |   |   |   |   |   |
| `safeguarding.view` | x | x | x |   |   |   |   |   |   |   |   |   |   |   |   |
| `sen.manage` | x | x | x |   |   |   |   |   |   |   |   |   | x |   |   |
| `sen.view` | x | x | x | x |   |   |   |   | x |   |   |   | x |   |   |
| `settings.manage` | x | x |   |   |   |   |   |   |   |   |   |   |   | x |   |
| `staff.manage` | x | x | x |   |   |   |   |   |   |   |   |   |   |   |   |
| `staff.view` | x | x | x |   |   |   |   |   | x | x |   |   |   |   |   |
| `students.archive` | x | x | x | x |   |   |   |   |   |   |   |   |   |   |   |
| `students.create` | x | x | x | x |   | x |   |   |   |   |   |   |   |   |   |
| `students.manage-documents` | x | x | x | x |   |   |   |   |   |   |   |   |   |   |   |
| `students.promote` | x | x | x | x |   |   |   |   |   |   |   |   |   |   |   |
| `students.transfer` | x | x | x | x |   |   |   |   |   |   |   |   |   |   |   |
| `students.update` | x | x | x | x |   | x |   |   |   |   |   |   |   |   |   |
| `students.view` | x | x | x | x | x | x | x | x | x | x | x | x | x |   |   |
| `timetable.manage` | x | x | x | x |   |   |   |   |   |   |   |   |   |   |   |
| `timetable.view` | x | x | x | x |   |   | x | x | x |   |   |   |   |   |   |
| `transport.manage` | x | x | x |   |   |   |   |   |   |   |   | x |   |   |   |
| `transport.view` | x | x | x |   |   |   |   |   |   |   |   | x |   |   |   |
