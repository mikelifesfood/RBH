# RBH Build 41 — Next-Step Guidance

Date: October 6, 2026

## Purpose
Make deliberate workflow transitions visually obvious without implying that the overall report is already complete.

## Visual language
- Red: something needs attention or more work.
- Blue: the current section is ready for the user's next deliberate action.
- Green: work is completed or verified.
- Black primary button: the action the user should take next.

## Changes
- Review: the decision area turns blue only when the Review step is editable and any required injury regulatory screening has been completed.
- Investigation: the footer remains neutral until both investigation questions are answered, then changes to a blue "Ready for the next step" panel.
- Corrective Action decision — No path: the Continue to Close area turns blue only after a reason and explanation are entered.
- Plan & Assign: the footer remains neutral until every required field is complete for every corrective action, then changes to a blue "Ready for the next step" panel.
- Verification: once all current corrective actions are verified, the final transition area is blue and the primary button reads "Continue to Close →".
- Close: when all close requirements are satisfied, the final Close action is presented in the same blue ready-state panel. The report is not described as closed until the user actually closes it.
- Ready-state guidance remains visible on mobile and when optional workflow guidance is hidden.

## Deliberately unchanged
- No database, SQL, RLS, role, notification, audit, or workflow-state changes.
- Individual Complete Work / Verify action cards were not given the blue stage-transition treatment. Those are work/review actions, not proof that the overall workflow is ready to advance.
- Investigator assignment remains preserved and disabled for the RBH-facing build as previously configured.

## Validation
- Inline JavaScript syntax checked with Node.js.
- ZIP integrity checked after packaging.
