# Common-Work Document Superpowers Design

> This design resets the document-enhancement direction for `common-work`. It does not extend the current `doc_state` / `openwork_knowledge` / sample-driven subagent stack. It starts from the question: what makes long document work behave more like a disciplined coding workflow without overloading the agent.

**Goal:** Make `common-work` materially stronger than raw local OpenCode for long document tasks, even when the user gives no extra prompt engineering.

**Why now:** The current document stack accumulated too many overlapping layers: main prompts, runtime instructions, MCP-specific guidance, bridge overlays, and sample-shaped subagent behavior. That made the system more powerful in isolated cases, but less coherent and less general.

## Core Thesis

The next version of document enhancement should copy the strengths of the `superpowers` coding workflow package, not the surface form of the current document stack.

The important property of `superpowers` is not that it is long. The important property is:

1. it routes by problem shape
2. it externalizes progress into reusable artifacts
3. it activates one workflow at a time
4. it teaches stable process moves, not sample-specific behavior

The document system should do the same.

## What We Learned From `superpowers`

The coding-side package works well because it has a strong workflow spine:

- a thin top-level router chooses the right process first
- each skill has a narrow job
- each skill produces artifacts for the next step
- the model is taught to resume from artifacts rather than chat memory
- the package generalizes because the stages are problem-shaped, not sample-shaped

Examples:

- `using-superpowers` decides that process selection must happen before action.
- `writing-plans` turns a fuzzy request into an explicit artifact that another workflow can execute.
- `systematic-debugging` defines a stable sequence of investigation, comparison, hypothesis, and verification.

Those skills are effective because they are explicit about:

- when to enter the workflow
- what the current stage is
- what artifact must exist before moving on
- what counts as completion

That is the model to copy.

## Why The Current Document Stack Drifted

The current document system mixes too many concerns into one visible surface:

- `common-work` explains runtime boundaries, file-reading policy, search rules, state rules, and delivery checks
- `document-writer` explains a full orchestration loop plus subagent contracts
- runtime instructions explain knowledge and document-state overlays
- tools expose `doc_state_*` and knowledge retrieval names directly
- bridge overlays repeat parts of the same behavior

That creates three failure modes:

1. the agent learns implementation vocabulary instead of a stable work model
2. prompt layers compete with one another
3. the system becomes easy to overfit to one evaluation sample

This is why the writer path gradually became a sample-shaped staged controller instead of a broad document workflow.

## Design Goals

The replacement design should satisfy all of these:

1. improve long-document quality without requiring user prompt tricks
2. reduce agent-visible implementation noise
3. work across multiple document scenarios, not just proposal writing
4. keep process artifacts lightweight and reusable
5. avoid making MCPs the center of the agent's mental model
6. let `document-writer` become a later `common-work-plus`, not the primary rescue path

## Non-Goals

This design does not aim to:

- preserve every current `doc_state` or knowledge overlay concept
- keep the current `doc-*` subagent topology intact
- optimize first for bid/proposal-only scenarios
- require MCP as the primary interface

## The New Mental Model

`common-work` should become a document execution agent with a small document workflow package behind it.

Its world model should be:

- there is a workspace
- there are source materials
- there is a target deliverable
- there is a small durable state surface
- there are helper operations for inspecting, refreshing, composing, and verifying

It should not need to think in terms of:

- `doc_state_*`
- `openwork_knowledge_search`
- `ragflow`
- runtime carrier overlays
- hidden orchestrator architecture

Those are implementation choices, not the agent's core reasoning frame.

## Recommended Architecture

### 1. Keep `common-work` thin

The main `common-work` prompt should only teach:

- workspace boundary
- read real sources early
- prefer durable state over rediscovery
- identify authority and target before drafting
- verify before finish

That is the constitutional layer.

### 2. Introduce a document workflow package

The document enhancement should be a package of workflow skills, analogous to `superpowers`.

Recommended package shape:

- `using-document-workflows`
- `document-intake`
- `document-evidence`
- `document-compose`
- `document-verify`
- optional later: `document-rewrite`

These are operation-shaped, not sample-shaped.

They correspond to broad classes of document work:

- intake and scoping
- extraction and evidence building
- composition and revision
- verification and delivery

### 3. Use file state as the source of truth

The durable state surface should stay file-backed.

Recommended minimum state set:

- `.worktree/index.json`
- `.worktree/sources/manifest.json`
- `.worktree/text/<doc-id>.txt`
- `.worktree/facts.json`
- `.worktree/coverage.json`
- `reports/verify.*`

Everything else should be optional.

This keeps recovery simple:

- reopen state
- inspect what exists
- continue from the next missing step

### 4. Use a thin CLI helper layer before betting on MCP

If the system needs helper operations, prefer a thin CLI facade first.

Recommended helper verbs:

- `inspect`
- `refresh-source`
- `refresh-facts`
- `verify-deliverable`

The agent does not need long command tutorials. It only needs to know what these verbs do and when to use them.

Example shape:

```bash
docflow inspect
docflow refresh-source --doc src-001
docflow refresh-facts
docflow verify-deliverable --target outputs/final.docx
```

Why CLI first:

- lower agent knowledge burden
- easier local/pod parity
- easier logging and replay
- easier to gate behind one contract

MCP can still exist later as a transport or wrapper, but it should not be the first-class mental model.

## Why MCP Should Be Secondary

MCP is useful when a capability genuinely benefits from tool discoverability, remote serving, or shared transport semantics.

But for long document work, MCP should not be the main design story.

The main design story should be:

- files are the truth
- helper verbs manipulate derived state
- the agent moves from one durable artifact to the next

If a helper is later implemented through MCP, that is acceptable. But the agent should still think in terms of the workflow action, not in terms of the MCP product name.

## The Document Workflow Spine

The document equivalent of the coding workflow spine should be:

### Stage A: Intake

Questions answered:

- what are the real source files
- what is the likely target deliverable
- what is authoritative
- what is obviously missing

Artifact outputs:

- `.worktree/index.json`
- `.worktree/sources/manifest.json`

### Stage B: Evidence Build

Questions answered:

- what text has been extracted
- what stable facts have been established
- what evidence supports each section or claim

Artifact outputs:

- `.worktree/text/<doc-id>.txt`
- `.worktree/facts.json`

### Stage C: Compose Or Revise

Questions answered:

- what exact deliverable should be produced or updated
- what sections need to be changed
- what evidence must appear in each section

Artifact outputs:

- stable draft or target deliverable
- optional writer report under `reports/**`

### Stage D: Verify

Questions answered:

- does the output match the requested shape
- are headings and section boundaries correct
- are unsupported claims or bad placeholders still present
- is the final path stable and reusable

Artifact outputs:

- `reports/verify.*`
- updated `.worktree/coverage.json`

The key point is that these stages are broad and reusable. They are not tuned to one project sample.

## Why This Generalizes Better

This model can handle:

- summarize two documents
- extract a requirement set
- rewrite a long report
- draft a proposal-style technical material
- revise an existing `.docx`
- verify a generated final deliverable

because the stages are based on document operations, not document genre.

Proposal writing becomes a task shape inside `document-compose`, not the whole architecture.

## What `common-work` Should Actually See

The ideal `common-work` prompt should not carry long explanations of:

- MCP names
- RAG system names
- product-specific knowledge services
- carrier config mechanics
- hidden subagent topology

It should see:

1. how to find real sources
2. how to use durable state first
3. when to search for external evidence
4. how to produce a stable deliverable
5. how to verify and stop

Everything else should be hidden behind:

- workflow skills
- file conventions
- helper commands

## What Should Happen To `document-writer`

`document-writer` should not remain the place where we experiment with every long-document rescue idea.

The intended order should be:

1. make `common-work` stronger than raw OpenCode
2. prove that the document workflow package generalizes across document tasks
3. only then design `document-writer` as a higher-control overlay

That means `document-writer` should eventually become:

- a controller for extra-strict, high-cost, or high-risk long document work
- not the default place where document capability actually lives

In other words:

`common-work` should be the real engine  
`document-writer` should be the stricter wrapper

## Anti-Overfitting Rules

Any new document workflow package must obey these rules:

1. no sample-specific nouns in shared prompts or helpers
2. no sample-specific section structures in shared contracts
3. no sample-specific system names in workflow skills
4. no stage exists solely because one evaluation sample needed it
5. every artifact must justify itself by reuse value across task types

If a concept only helps one sample family, it belongs in evaluation harnesses, not the core workflow package.

## Proposed First Implementation Slice

Do not start by rebuilding the whole stack.

Start with one narrow slice:

1. define the minimal durable state schema
2. define the document workflow package structure
3. define a tiny CLI helper surface
4. reduce `common-work` to the constitutional layer
5. test the new model on:
   - summary
   - proposal-style drafting
   - revision of an existing document
   - evidence-backed verification

That will reveal whether the workflow spine is actually general.

## Success Criteria

This redesign is successful if:

- `common-work` produces better long-document behavior than raw OpenCode without user prompt tricks
- the agent needs fewer product-specific instructions
- the number of durable state artifacts is smaller but more useful
- document tasks resume from artifacts instead of chat memory
- `document-writer` is no longer required just to get acceptable long-task behavior
- new document scenarios do not require new sample-shaped subagents

## Decision

Rebuild document enhancement around:

- a thin `common-work` constitution
- a document workflow skill package
- file-backed state as the truth surface
- a thin CLI helper facade
- MCP as an optional implementation detail, not the architectural center

That is the path most likely to produce coding-workflow-like discipline without turning the document system into another sample-specific orchestration tree.
