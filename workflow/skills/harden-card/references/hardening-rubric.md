# Card Hardening Rubric

Use this reference when a specific gap or risk needs a decision before
implementation. Stop once the card is executable.

## Readiness

- Can the implementer tell what should change from the card and repository?
- Can a reviewer observe the intended result with a focused test or smoke?
- Is there a true execution blocker or a consequential failure to address?

For a small UI adjustment, state the changed behavior and its verification.
Existing layout, empty states and keyboard behavior only need new criteria
when a relevant requirement or the change itself puts them at risk.

## Consequential changes

Name the failure that matters and the invariant that prevents it. Examples
include an upload being charged twice on retry, a migration losing records, or
one account gaining access to another account's data. Link the relevant domain
rule, give the minimum adequate proof, and use the delivery contract to route
the risk. Record only real dependencies as native blockers.
