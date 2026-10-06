# RBH Build 36 - Injury Regulatory Follow-up

## UX changes
- Step 1 asks a plain-language question: No / Unsure / Yes for immediate regulatory attention.
- Unsure and Yes require the company-awareness date/time.
- Unsure stays active in later workflow steps and can be updated without reopening or editing the completed Review step.
- Unsure or Yes can record `Cal/OSHA has been notified`; checking it records a notification timestamp and stops the live elapsed display.
- A Pending/Unsure determination must eventually become Yes or No before final record closure.
- A Yes determination must have a recorded Cal/OSHA notification before final record closure.
- Previously recorded notification data is preserved and included in CSV/PDF/audit output.

## Important design boundary
The application only tracks that an authorized user says Cal/OSHA was notified. It does not make the legal determination and does not transmit the notification.

## Deployment
1. Run `supabase/RBH_BUILD36_INJURY_REGULATORY_FOLLOWUP_V1.sql` once in the RBH Supabase SQL editor.
2. Deploy the Build 36 `dashboard.html` (or the full ZIP).
3. Test injury paths: No; Unsure -> No; Unsure -> Yes -> notified; Yes -> notified.
