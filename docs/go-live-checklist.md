# School go-live checklist

This checklist is a release gate, not optional documentation. A school should
not put live pupil, health, safeguarding or finance data into the system until
each applicable item has an owner and evidence of completion.

## Service ownership

- Assign a school administrator, finance owner, safeguarding owner and technical
  contact. Do not share the administrator login.
- Replace all demonstration accounts and data. Do not set `RUN_SEED=1` in a
  live environment.
- Use a domain with HTTPS. Set `AUTH_URL`, `NEXT_PUBLIC_APP_URL`, `AUTH_SECRET`
  and `AUTH_TRUST_HOST=true` correctly for that domain.
- Store secrets in the hosting provider's secret store, not in source control
  or a shared spreadsheet.

## Finance controls

- Confirm the fee structure, currencies, invoice numbering and cashier roles.
- Reconcile each bank, mobile-money and POS settlement against the system daily.
  A payment proof is not a cleared payment until finance verifies it.
- Have an independent bursar/head review reversals, cash-up and debtors weekly.
- Validate statutory reports and payroll calculations against the current
  requirements supplied by the school's accountant. This project does not
  submit returns to government portals automatically.

## Communication

- Verify the email sending domain and set `RESEND_API_KEY` and `RESEND_FROM`.
- Configure an SMS provider endpoint, test an actual parent number, and record
  the provider's delivery-report process.
- Publish a test announcement and a password reset, then retain evidence that
  both were delivered. Failed outbox entries must have an assigned owner.

## Privacy and safeguarding

- Obtain the school's approved privacy notice and retention schedule.
- Limit clinic, SEN, discipline and safeguarding roles to named staff.
- Define who reviews open safeguarding cases, when, and how escalations are
  handled outside the software.
- Keep documents in configured S3-compatible storage for production; restrict
  storage access and encrypt provider backups.

## Resilience and verification

- Schedule `scripts/backup.ps1` daily using a Windows Scheduled Task or the
  host scheduler. Copy the resulting backup and checksum manifest to encrypted
  off-site storage.
- Run `scripts/verify-backup.ps1` after every backup and perform a full restore
  rehearsal at least once per term on a separate database.
- Monitor `/api/health`; alert when it returns non-200. It checks both the
  database and configured Redis service.
- Test the school’s actual office PCs, printers, Android phones, Wi-Fi and
  power/interruption procedure before term starts.

## Access policy

- Require individual staff accounts, not shared accounts.
- The system enforces new/reset passwords of at least 12 characters with upper,
  lower and numeric characters. Require a password manager for privileged roles.
- Place the application behind an identity provider or VPN with MFA for finance,
  safeguarding and administration staff until native MFA is introduced.
