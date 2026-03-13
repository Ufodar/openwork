# Document Operations Model v1

## Goal

Define a document-native operating model for OpenWork agents.

This model is the upstream source of truth for:

- `.opencode/agent/common-work.md`
- `.opencode/agent/document-writer.md`
- document-related plugins
- future document-specific skills

The target scenario is not generic chat writing. It is:

- many files in one workspace
- large documents
- long-running multi-step tasks
- strong semantic dependencies across sections
- a real deliverable file that must remain internally consistent

## Why This Model Is Needed

The current system has three structural problems:

1. It over-trusts generic skills that were not designed for document-heavy workspaces.
2. It treats skill names as a workflow, instead of treating document work as a domain with its own invariants.
3. It optimizes for local edits, while document quality depends on whole-document coherence.

The result is predictable:

- the agent loads noisy skills
- routing becomes unstable
- section-level edits degrade full-document logic
- long tasks drift because state is not explicit enough

This model fixes that by defining document work before defining prompts or skills.

## Core View

Document work is not "writing some text".

It is the controlled transformation of source materials into a stable deliverable under constraints.

Every serious document task has five persistent dimensions:

1. source authority
2. target deliverable
3. document-wide coherence
4. explicit state
5. stage transitions

If any of these are weak, the agent will look busy while quality decays.

## Non-Negotiable Invariants

### 1. Authority Hierarchy

Not all inputs are equal.

The agent must identify:

- which file is authoritative
- which files are supporting
- which files are reference-only
- which files are derived outputs

If two sources conflict, the hierarchy must decide the outcome.

Typical hierarchy:

1. user-designated target and primary source files
2. formal requirement documents, addenda, clarifications, attachments
3. template files and prior deliverables
4. background notes, old drafts, external references

The agent must not silently blend conflicting sources.

### 2. Stable Target Document

The agent should work toward one stable output file, not generate endless "final-v2-v3" variants.

If the target file is not known, that is a blocking question.

If a template or half-finished deliverable exists, the default should be:

- reuse
- modify in place or through one controlled working copy
- keep the output path stable

### 3. Whole-Document Coherence Over Local Polish

A document is a dependency graph, not a bag of paragraphs.

Any meaningful edit can affect:

- terminology
- numbering
- references to sections, tables, figures, appendices
- commitments made earlier in the document
- conclusions implied later in the document

Therefore local polish is always subordinate to document-wide coherence.

The agent must assume:

- a better paragraph can still be a worse document
- changing one section may require checking neighboring sections
- "done" on a long document requires a whole-document pass, not only local edits

### 4. Explicit State Beats Chat Memory

Long document tasks should not depend on fragile short-term context.

The workspace must carry state.

Recommended state artifacts:

- `requirements.csv`
- `.worktree/index.json`
- `.worktree/conventions.md`
- `.worktree/facts.json`
- `reports/*`

State files should preserve:

- canonical filenames
- authority decisions
- current target document
- accepted terminology
- unresolved gaps
- section dependencies
- pending validation work

### 5. Stage-Based Progress

Document work should progress through explicit stages.

The default stages are:

1. intake
2. authority resolution
3. extraction
4. planning
5. drafting or revision
6. coherence check
7. final verification
8. delivery

The agent does not need to announce every stage, but it must know which stage it is in.

## Canonical Workflow

### Stage 1: Intake

Goal:

- identify the relevant files
- identify the likely target output
- identify obvious blockers

Rules:

- read real files early
- do not stay in discovery mode for long
- do not load generic writing skills before reading real inputs

### Stage 2: Authority Resolution

Goal:

- determine which file governs the task
- determine whether there are conflicting sources

Rules:

- authority conflicts must be surfaced
- unclear target file is a blocking question
- path names must come from real tool output

### Stage 3: Extraction

Goal:

- convert inputs into usable structure

Typical outputs:

- extracted requirements
- facts
- section map
- table map
- source-to-claim mapping

Rules:

- use format-specific tools first
- do not directly `read` binary Office files
- extraction outputs are intermediate artifacts, not final deliverables

### Stage 4: Planning

Goal:

- define the minimum safe route to the deliverable

This stage is required when the work is:

- multi-file
- multi-round
- high-risk
- or structurally ambiguous

Planning should answer:

- what is the target file
- what sections or tables will change
- what source files support each change
- what still needs validation

### Stage 5: Drafting Or Revision

Goal:

- change the target file without breaking document-wide integrity

Rules:

- reuse first, generate second
- prefer controlled edits over full rewrites
- before major revision, reread title, outline, adjacent sections, and existing conclusions
- if a change affects multiple sections, update the dependency view first

### Stage 6: Coherence Check

Goal:

- ensure the document still works as one document

Checks include:

- terminology consistency
- no contradictory claims
- numbering stability
- section references still valid
- tables and narrative still agree
- facts and dates still align with source materials

This stage is separate from formatting or file-level validation.

### Stage 7: Final Verification

Goal:

- verify the actual completion claim

This is where `verification-before-completion` belongs.

It is not the main review skill. It is a gate before saying:

- completed
- checked
- verified
- ready to deliver

### Stage 8: Delivery

Goal:

- leave the workspace in a recoverable state
- make the final output visible and auditable

Deliverable quality means:

- the target file exists in the expected place
- supporting state is sufficient for continuation
- unresolved gaps are explicit

## Task Types

The agent should distinguish at least four kinds of document work.

### 1. Extraction Tasks

Examples:

- extract requirements
- extract scoring criteria
- build response matrix
- collect key facts

Primary concern:

- structure and accuracy

Default capabilities:

- `pdf`
- `docx`
- `xlsx`

### 2. Controlled Revision Tasks

Examples:

- revise a section
- fill a response item
- update language in an existing deliverable

Primary concern:

- preserving the document while changing part of it

Default capabilities:

- `docx`
- current workspace state files

### 3. Multi-Source Assembly Tasks

Examples:

- assemble a formal deliverable from many files
- combine template, source tables, and narrative evidence

Primary concern:

- authority mapping and section dependencies

Default capabilities:

- format skills
- state files
- `writing-plans` only if the task is genuinely multi-phase

### 4. Verification Tasks

Examples:

- review for conflicts
- check completeness
- compare versions
- validate a final package

Primary concern:

- evidence-backed quality judgment

Default capabilities:

- relevant format skills
- state files
- `verification-before-completion` only at the final claim boundary

## What Common-Work Should Encode

`common-work.md` should remain minimal and universal.

It should encode:

- workspace boundary
- binary file safety
- path fidelity
- authority-first behavior
- stage awareness
- whole-document coherence
- state over memory
- two-strike rerouting

It should not encode:

- noisy skill marketing
- speculative skill combinations
- product names for optional systems
- detailed domain workflows that only apply to one narrow scenario

## What Document-WRiter Should Encode

`document-writer.md` should be more specific than `common-work.md`, but still document-native.

It should encode:

- high-requirement formal document behavior
- how to handle authority-heavy work such as tenders, proposals, plans, and reports
- when to ask blocking questions
- how to protect the target deliverable from uncontrolled rewrites
- how to review long-form coherence before claiming success

It should not depend on optional domain skills to remain functional.

## What Plugins Should Encode

Plugins are the right place for:

- global routing nudges
- compaction rules
- continuation contract
- document-mode bias toward file-format skills and state files

Plugins are not the right place for:

- domain-specific writing philosophy
- long skill catalogs
- brittle tool-name orchestration

Plugins should stay thinner than agent prompts.

## What Skills Should Exist

Only create or keep a skill if it improves real document outcomes.

The first trustworthy set should be small.

### Keep As Core

- `docx`
- `pdf`
- `xlsx`
- `pptx`

### Keep As Process Gates

- `writing-plans`
- `systematic-debugging`
- `verification-before-completion`

### Rebuild Before Trusting

- collaborative writing skill for long-document revision
- document-wide consistency review skill
- evidence and citation enrichment skill for formal documents

### Do Not Put In The Default Path Until Proven

- generic brainstorming
- generic file organizing
- internal-comms tone helpers
- broad "research writer" skills copied from blog/article workflows

## Proposed New Skills

These would provide more value than patching the current low-trust skills.

### 1. `long-document-revision`

Purpose:

- revise part of a long document without damaging whole-document coherence

Must teach:

- what to reread before editing
- how to map section dependencies
- when local edits require broader review
- how to close open loops after revision

### 2. `document-consistency-check`

Purpose:

- check whether a long document still works as one consistent deliverable

Must teach:

- terminology checking
- conflict detection
- numbering and reference integrity
- section-to-table consistency
- unresolved gap reporting

### 3. `document-evidence-mapping`

Purpose:

- map claims in the deliverable to authoritative sources

Must teach:

- source hierarchy
- claim-to-source traceability
- how to mark unsupported claims
- when to ask for missing evidence

## Quality Bar For Future Changes

Any future update to document prompts, plugins, or skills should pass this bar:

1. Does it improve outcome quality for large, multi-file document work?
2. Does it reduce routing noise rather than add it?
3. Does it help preserve whole-document coherence?
4. Does it make state more explicit?
5. Does it still work when optional skills are absent?

If the answer to any of these is no, the change should not be in the default path.

## Immediate Consequences

Starting now, the safe default is:

- format skills first
- real files first
- workspace state first
- process skills only when justified
- generic document skills only after they are rebuilt for document-native behavior

This is the foundation for the next changes:

1. simplify `common-work.md`
2. simplify `document-writer.md`
3. thin the document-mode bridge
4. replace low-trust generic writing skills with document-native ones
