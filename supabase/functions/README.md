# Supabase Edge Functions

These files are source-control copies of the Edge Functions used by the current RBH Safety build.

## `notify-report`

New-report email notification through Brevo. Build 46 dynamically resolves every active Admin and Safety Manager in the report organization from `public.profiles`; `NOTIFY_TO` is no longer used. The deployment is triggered from Postgres/pg_net and uses `BREVO_API_KEY`, `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME`, `WEBHOOK_SECRET`, `DASHBOARD_URL`, and `LOGO_URL`, plus Supabase's standard service-role environment variables.

## `send-action-assignment-email`

Authenticated transactional workflow notifications through Brevo. Build 46 supports Report Owner handoffs, the preserved future Investigator assignment, Corrective Action assignment, changes requested, the preserved optional Verification Owner assignment, and verification requests. RBH verification requests route to the current Report Owner, with an active Admin/Safety Manager fallback if ownership is unavailable.

## `translate-report`

Authenticated translation function used for viewer-language report/PDF presentation. Original report content remains unchanged.

## `admin-manage-user`

Authenticated Admin-only user-management function for role changes, activation/deactivation, password-reset delivery, and removal of login access. It validates the caller, organization, self-protection rules, and last-active-Admin protection before using trusted backend access. Build 52 updates the database profile-security guard so these approved service-role updates are not incorrectly rejected by the legacy trigger.

Do not commit secret values here. Deploy/update functions through the Supabase dashboard unless the project later adopts an automated deployment process.
