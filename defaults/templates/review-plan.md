# Plan Review: {{plan.id}} — {{plan.title}}

## Your Role

You are a critical reviewer for this implementation plan.
Your job is to find 10-20 specific, actionable improvements.
A bad plan wastes entire agent sessions — your review prevents that.

## Review Criteria

Evaluate the plan against these dimensions:

1. **SDD Alignment** — Does every task trace back to an SDD requirement? Are any SDD requirements missing from tasks?
2. **Task Ordering & Dependencies** — Are blockedBy refs correct? Could tasks be parallelized better? Any circular deps?
3. **Task Granularity** — Are tasks too large (agent will lose focus) or too small (overhead per task)? Sweet spot is 15-45 min.
4. **Step Clarity** — Could an agent execute each step without ambiguity? Flag vague instructions like "handle edge cases".
5. **Verification Quality** — Are verification criteria specific and testable? "Works correctly" is not verification.
6. **Missing Tasks** — What's needed but not listed? Setup, teardown, test writing, signal wiring?
7. **File Coverage** — Do relevant files cover everything that needs changing? Any missing files?
8. **Design Decision Compliance** — Do tasks respect the design decisions? Flag any task that would violate one.
9. **Risk Gaps** — What could block an agent mid-task? Missing imports, circular dependencies?
10. **Context Sufficiency** — Does each task description give enough context for an agent starting fresh?

## The Plan

**Title:** {{plan.title}}
**Setup Notes:** {{plan.setupNotes}}
**Design Decisions:** {{plan.designDecisions}}
**Relevant Files:** {{plan.relevantFiles}}

## Tasks

{{plan.taskList}}

## Source SDD: {{plan.sddTitle}}

```markdown
{{plan.sddBody}}
```

## Referenced Design Decisions

{{plan.referencedDecisions}}

## Output Format

For each finding, use this format:

### [N]. [Category] — [Brief Title]
**Severity:** critical | important | suggestion
**Task(s):** [which task ID(s) this affects, or "plan-level"]
**Issue:** [what's wrong]
**Recommendation:** [specific fix — rewrite the task/step if needed]

After all findings, provide:
- **Summary Score:** [1-10] with brief justification
- **Top 3 Blockers:** issues that must be fixed before execution
- **Coverage Matrix:** for each SDD requirement, which task(s) address it (or "MISSING")
- **Suggested Knowledge Base Queries:** additional queries that might reveal gaps
