# Coding standards

[README.md](README.md) owns architecture and operational knowledge; package.json
and tool configuration own commands and enforced conventions.

## Changes and reviews

**Evidence.** Before proposing a change or finding, establish requested behavior,
affected contracts and invariants, critical paths, and consequential unknowns
from relevant sources. Distinguish verified evidence, inference, and open
questions. Reproducible observations and active code establish current behavior;
the task, contracts, invariants, and supporting tests establish intended behavior.
Resolve disagreements as a bug, stale documentation or test, intentional change,
or evidence gap before deciding what to change.

**Decision.** Choose the smallest complete change that addresses the cause. For a
structural cause, compare local or staged remedies with a structural remedy,
considering reliability, operability, performance, maintainability, testability,
and migration cost. Justify a rewrite by why local or staged changes are
insufficient. Preserve public contracts unless the task or an evidence-backed
decision justifies changing them; account for compatibility and migration.
Follow project conventions; justify new dependencies and convention changes.
Update affected tests and documentation with changed behavior or contracts.

**Completion.** A change is complete when the requested outcome is demonstrated,
affected invariants and critical paths are checked, relevant regression risks
are addressed, and code, tests, and documentation agree. A review is complete
when every area in its requested scope is checked and each finding has evidence
or an explicit evidence gap. For browser UI or real-time room/playback changes,
read [e2e/README.md](e2e/README.md) for acceptance requirements. Report checks
actually performed and results, unverified behavior, material residual risks,
and warranted rollout or post-change checks.

## Audits

Bound the investigation by the requested goal, scope, constraints, and invariants;
state the narrowest supported scope when implicit. Apply the evidence and
decision rules above. Account for every relevant existing area within scope with
evidence or an explicit limitation.

For each significant finding, record location, evidence, root cause, affected
paths, severity, impact, and feasible remedies. Recommend a solution or
prioritized roadmap; explain material trade-offs, confidence in the evidence,
preserved invariants, fully or partially resolved problems, next steps, and
remaining risks. Apply the change completion criteria when implementing.

For README consolidation, identify existing coverage, onboarding or operational
gaps, and unsupported claims. Update the existing README when edits are within
the task's scope, including documented behavior changed by authorized
implementation. For read-only work, provide in-scope corrections as
recommendations. Use stable, verified knowledge that helps onboarding or
operation; distinguish facts, rationale, operational notes, limitations, and
improvement proposals.

An audit is complete when every scoped area is accounted for, findings and
recommendations follow from evidence, and authorized README changes agree with
the examined sources. Report checks and results, residual risks, changed README
sections, and material areas left undocumented because evidence is insufficient.
