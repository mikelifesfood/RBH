# RBH Build 27 - Close Step Pending State

## Change
When all corrective actions have been individually verified but the reviewer is still viewing Step 3 - Corrective Actions / Verify Work, Step 4 - Close remains gray/pending.

The reviewer must use **All actions verified - Continue to Close** before the Close step becomes the active black workflow step.

## Scope
Presentation/navigation only. No Supabase schema, RLS, notification, corrective-action status, evidence, or permission logic was changed.

## Reason
The workflow indicator should reflect the user's explicit position in the process. Individual actions being verified makes Step 3 complete, but the reviewer has not yet advanced into final closure.
