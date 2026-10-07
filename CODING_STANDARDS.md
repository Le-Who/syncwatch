# Coding standards

## Evidence and priorities

When engineering goals compete, prioritize correctness and source alignment,
reliability and regression safety, determinism and maintainability, architectural
clarity, performance and operational efficiency, completeness, simplicity, then
conciseness.

When sources disagree, use this evidence order unless the task specifies another:

1. Reproducible runtime behavior, logs, and failures.
2. Code in the active execution path.
3. Integration, end-to-end, and contract tests.
4. Schemas, migrations, types, and API contracts.
5. Configuration, CI, scripts, and infrastructure manifests.
6. Unit tests.
7. README, documentation, and comments.
8. Assumptions.

Classify a disagreement as outdated documentation, an implementation bug, an
outdated test expectation, an intentional behavior change, or insufficient
evidence before deciding which artifact to change. Distinguish verified evidence,
inference, risks, and open questions in the reasoning that supports the decision.

## Before changes

Inspect the code, tests, configuration, and documentation relevant to the task.
Before proposing a solution, state the affected behavior, requested change,
source of truth, must-preserve invariants, critical paths, and consequential
unknowns. Keep this account proportional to the scope.

Before editing, give a brief implementation plan identifying likely files,
contracts to preserve, and relevant validations. Include containment or rollback
when the change carries meaningful risk. Explain material changes to the plan.

## Implementation

- Choose the smallest complete fix. Consider a rewrite only when local or staged
  changes are insufficient; accept larger changes when evidence justifies their
  reliability, operability, performance, or maintainability gains.
- For a structural root cause, compare at least one minimally invasive option
  with one structural option. Evaluate root-cause resolution rather than cosmetic
  differences or line-count reduction.
- Preserve public contracts unless the task justifies changing them. Account for
  compatibility and migration costs when proposing a contract change.
- Add dependencies only when their value justifies the maintenance cost.
- Follow established project conventions unless there is a supported reason to
  improve them. Consult package.json and tool configuration for commands and
  enforced conventions rather than maintaining copies here.
- Update relevant tests and documentation when behavior or contracts change.

## Verification

Before finalizing, establish that the requested change is complete, preserved
invariants still hold, and relevant critical paths and regression risks have been
checked. Include performance-sensitive or operational paths when affected.
Reconcile contradictions among the changed code, tests, documentation, and
conclusions.

Report the checks actually performed, their results, and material residual risks
or uncertainties. Include rollout or post-change checks when the risk warrants
them.

## Repository audits

Apply this sequence when the task requests a repository audit, architecture
review, or README consolidation. Use the task's goal, scope, constraints, and
invariants to bound the investigation. If scope is implicit, state the narrowest
supported interpretation before proceeding.

1. **Understanding:** Establish purpose, module boundaries, data and control
   flows, dependencies, architectural invariants, critical and operationally
   sensitive paths, and evidence gaps. Cover each relevant existing area:
   entry points and application structure; state and persistence; schemas and
   contracts; jobs, queues, schedulers, and integrations; configuration and
   environment; authentication and permissions; error handling and recovery;
   concurrency; performance; tests; build, release, deployment, and developer
   operations. Report absent systems when their absence matters to the task.
2. **README gaps:** Identify existing coverage, missing onboarding or operational
   knowledge, and areas that lack enough evidence to document. Propose only
   relevant additions to the existing structure.
3. **Problem map:** For each significant finding, provide its location, evidence,
   impact and severity, root cause, affected paths, available mitigation, and
   structural fix. Consider architecture, coupling, duplication, hidden
   dependencies, boundaries, extensibility, testability, reliability, operations,
   and performance; include security findings when evidence supports them.
4. **Options:** Compare two to four independent options for each significant
   problem. Include a minimally invasive option where realistic and a structural
   option for a structural cause. Compare scope, expected impact, advantages,
   costs, risks, maintainability, reliability, performance, testability,
   compatibility, migration, and the circumstances in which each option fits.
5. **Refinement:** Merge overlapping options and remove unsupported or decorative
   proposals. Check symptoms against root causes, invariant preservation, hidden
   edge cases, operational concerns, and the cost of leaving causes unresolved.
   Distinguish quick wins, medium changes, and structural changes. For each
   retained option, state its strongest advantage, largest risk, key trade-off,
   confidence, and evidence quality.
6. **Decision:** Recommend a solution, phased roadmap, or justified combination.
   Explain the choice and relevant rejected alternatives, preserved invariants,
   fully and partially resolved problems, and remaining risks.
7. **Delivery:** For requested implementation, follow the preparation,
   implementation, and verification rules above, including planned README
   changes. For an analysis-only task, deliver a prioritized improvement roadmap
   and README update plan with concrete next steps.

## README maintenance

When README changes are requested or the task changes documented behavior,
update the existing README with stable, verified project knowledge. Include
implementation detail when it materially helps onboarding or operations.

Keep verified facts distinguishable from design rationale, operational notes,
limitations, and improvement proposals. Describe material evidence gaps instead
of filling them with assumptions. Check the resulting README against the
relevant implementation, tests, configuration, and operational evidence.

Report added or modified sections, corrected or removed outdated material, and
material areas intentionally left undocumented because evidence is insufficient.
