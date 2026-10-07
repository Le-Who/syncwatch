# Coding standards

## Changes and reviews

### Scope and evidence

Establish the affected behavior, requested outcome, public contracts,
must-preserve invariants, critical paths, and consequential unknowns before
proposing changes or review findings. Keep this account proportional to scope.
Use README.md for project context, then inspect the relevant execution paths,
tests, schemas, and configuration.

When sources disagree, classify the discrepancy as an implementation bug,
outdated documentation, an outdated test expectation, an intentional behavior
change, or insufficient evidence. Use reproducible observations and active code
to establish current behavior; use the task, contracts, and supporting tests to
establish intended behavior. Resolve that distinction before choosing which
artifact to change. Distinguish verified evidence, inference, and open questions
in conclusions.

### Change selection

Choose the smallest complete change that addresses the cause. For a structural
cause, compare a local remedy with a structural remedy, considering root-cause
resolution, reliability, operability, performance, maintainability, testability,
and migration cost. Use a rewrite when local or staged changes are insufficient.

Preserve public contracts unless the task or an evidence-backed decision
justifies changing them; account for compatibility and migration. Follow project
conventions and justify dependencies by their value and maintenance cost.
Consult package.json and tool configuration for current commands and enforced
conventions.

Before editing, state a brief plan identifying files, preserved contracts, and
validations; include containment or rollback for meaningful risk. Explain
material changes to the plan. Update affected tests and documentation alongside
changed behavior or contracts.

### Verification and completion

Select checks for the changed behavior, affected invariants, critical paths, and
regression risks, including operational and performance paths when affected.
For browser UI or real-time room/playback changes, read
[e2e/README.md](e2e/README.md) for acceptance requirements.

A change is complete when the requested outcome is demonstrated, affected
invariants and critical paths are checked, and relevant code, tests, and
documentation agree. A review is complete when its requested scope is checked
and each finding has supporting evidence or an explicit evidence gap.

Report checks actually performed and their results, unverified behavior, and
material residual risks. Include rollout or post-change checks when warranted.

## Audits

### Coverage

Bound the investigation by the task's goal, scope, constraints, and invariants.
State the narrowest supported scope when implicit. Apply the
[evidence rules](#scope-and-evidence) before proposing findings.

Account for each relevant existing area within scope: entry points and module
boundaries; data, control, and state flow; persistence, schemas, and contracts;
jobs, queues, schedulers, and integrations; configuration and environment;
authentication and permissions; error recovery; concurrency; performance;
tests; and build, release, deployment, and developer operations.

Coverage is complete when every scoped area has evidence or an explicit
limitation. Identify absent systems when their absence matters to the task.

### Findings and decisions

For each significant finding, record location, evidence, root cause, affected
paths, severity and impact, a feasible local mitigation, and a structural remedy
when the cause is structural. Include security findings when supported by
evidence.

Compare independent feasible remedies using the [change-selection criteria](#change-selection).
Consolidate overlapping options and challenge unsupported causes, compatibility
risks, hidden edge cases, unnecessary complexity, and omitted operational or
performance effects. State material trade-offs and confidence in the evidence.

Recommend a solution or prioritized phased roadmap. Explain the choice,
relevant rejected alternatives, preserved invariants, fully or partially
resolved problems, concrete next steps, and remaining risks. Apply the change
and verification rules above when implementation is requested.

### README maintenance

For requested README consolidation, identify existing coverage, missing
onboarding or operational knowledge, and evidence gaps. For an analysis-only
assignment, deliver a justified README update plan when it is within scope.

When README edits are requested or the task changes documented behavior, update
the existing README with stable, verified knowledge. Keep facts distinguishable
from rationale, operational notes, limitations, and improvement proposals.
Document implementation detail when it helps onboarding or operation; leave
script, version, default, and file-inventory lookups in their authoritative
sources.

README work is complete when the affected documentation agrees with relevant
implementation, tests, configuration, and operational evidence. Report added or
modified sections, corrected or removed material, and material areas left
undocumented because evidence is insufficient.
