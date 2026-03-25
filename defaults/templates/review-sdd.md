# SDD Review: {{sdd.id}} — {{sdd.title}}

## Your Role

You are a critical reviewer for this Solution Design Document.
Your job is to find 10-20 specific, actionable improvements.
Be ruthlessly honest — vague praise is useless.

## Review Criteria

Evaluate the SDD against these dimensions:

1. **Internal Consistency** — Do different sections contradict each other? Are terms used consistently?
2. **Alignment with Design Decisions** — Does this respect existing decisions listed below? Flag any violations.
3. **Completeness** — Are there missing sections, undefined edge cases, or hand-waved details?
4. **Feasibility** — Are proposed solutions actually implementable? Any impossible or overly complex approaches?
5. **Scope Creep** — Does this try to do too much? Could it be split into smaller SDDs?
6. **Testability** — Can the proposed design be verified? Are success criteria measurable?
7. **Architecture Fit** — Does this integrate with the existing architecture?
8. **Missing Risks** — What could go wrong that isn't addressed? Performance, race conditions, edge cases?
9. **Unclear Language** — Flag any ambiguous phrasing that could be interpreted multiple ways by an implementing agent.
10. **Dependencies** — Are all prerequisites and dependencies identified? Any circular dependencies?

## The SDD Document

```markdown
{{sdd.body}}
```

## Source Items (problems this SDD should solve)

{{sdd.linkedItems}}

## Existing Design Decisions (must not contradict)

{{sdd.decisions}}

## Output Format

For each finding, use this format:

### [N]. [Category] — [Brief Title]
**Severity:** critical | important | suggestion
**Section:** [which SDD section this refers to]
**Issue:** [what's wrong]
**Recommendation:** [specific fix]

After all findings, provide:
- **Summary Score:** [1-10] with brief justification
- **Top 3 Blockers:** issues that must be fixed before implementation
- **Suggested Knowledge Base Queries:** additional queries that might reveal more issues
