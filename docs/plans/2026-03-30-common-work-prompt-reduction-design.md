# `common-work.md` Prompt Reduction Design

## Goal

Reduce [`common-work.md`](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/agent/common-work.md) from an incident-driven rule catalog into a smaller execution contract.

The reduction target is:

- keep only the hard runtime boundaries and core workflow rules in the main prompt
- move detailed quality checks and historical patch rules out of the main prompt when possible
- preserve the behaviors that currently prevent the most common hosted document failures

This note classifies the current prompt into:

- must keep
- can demote
- can merge or remove

## Current Prompt Shape

The current file is 312 lines and mixes four different concerns:

1. runtime/file-safety boundaries
2. document workflow sequencing
3. output quality and proposal-writing rules
4. historical bug patches encoded as explicit negative examples

That mix makes the prompt strong, but also heavy. The biggest risk is not that the rules are wrong. The biggest risk is that the model cannot reliably tell which rules are constitutional and which are merely historical cautions.

## Must Keep

These rules belong in the main prompt because removing them would likely reintroduce severe failures.

### A. Workspace boundary contract

Keep the core of:

- work only inside `<WORKSPACE>`
- `.tmp` is intermediate only
- final deliverables must be moved to stable user-visible paths
- do not use workspace-external directories as default input/output paths
- do not expose pod/runtime absolute paths in final user-facing summaries

Source area:

- [`common-work.md:39`](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/agent/common-work.md#L39)

Why it stays:

- This is a real hosted-runtime boundary, not writing advice.
- It protects session isolation and keeps final delivery paths stable.

### B. Read real files early

Keep the core of:

- do lightweight discovery once
- do not keep rediscovering the workspace
- read a real source quickly
- if `.worktree/index.json` or `.worktree/sources/manifest.json` exists, read it first
- do not overwrite existing state files with blind `write`

Source area:

- [`common-work.md:55`](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/agent/common-work.md#L55)

Why it stays:

- This is the main anti-drift rule set.
- It prevents the agent from hovering in discovery/search/planning loops instead of touching source material.

### C. Binary handling and bootstrap text preference

Keep the core of:

- do not `read` binary office files directly
- prefer existing bootstrap text surfaces such as `.worktree/text/*.txt`
- only re-extract original binaries when the existing text surface is absent or insufficient

Source areas:

- [`common-work.md:17`](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/agent/common-work.md#L17)
- [`common-work.md:73`](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/agent/common-work.md#L73)
- [`common-work.md:102`](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/agent/common-work.md#L102)

Why it stays:

- This directly addresses repeated hosted document failures.
- It is now part of the product contract, not just prompt style.

### D. Authority and target resolution

Keep the core of:

- identify the authority source
- identify the stable target document
- do not let auxiliary documents override the main requirement/tender document
- do not search until a real missing fact has been identified

Source area:

- [`common-work.md:114`](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/agent/common-work.md#L114)

Why it stays:

- This is the main anti-mis-scoping protection.
- It is especially important in multi-document proposal tasks.

### E. State over memory

Keep the core of:

- long tasks should leave recoverable state in `.worktree/**`
- state should capture canonical filenames, authority source, target doc, confirmed facts, and coverage

Source area:

- [`common-work.md:166`](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/agent/common-work.md#L166)

Why it stays:

- This is a core design principle of the hosted long-task system.

### F. Verify before completion

Keep the core of:

- generated is not equal to done
- final deliverables must be re-opened or reliably scanned
- completion requires actual verification

Source area:

- [`common-work.md:229`](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/agent/common-work.md#L229)

Why it stays:

- This is the line between “file exists” and “deliverable is trustworthy”.

## Can Demote

These rules are useful, but do not all need to sit in the main controller prompt.

### A. Detailed search-quality policy

Examples:

- limits on number of searches
- “one gap at a time”
- “do not use webfetch as search”
- “do not search portal/ecommerce/homepage”
- preference nuances across multiple MCPs

Source area:

- [`common-work.md:123`](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/agent/common-work.md#L123)

Why demote:

- The high-level rule is enough in the main prompt:
  - search only for explicit gaps
  - prefer authoritative sources
  - report blockers honestly
- The detailed search policy belongs better in a search helper prompt, search bridge, or verifier.

### B. Proposal/API hygiene details

Examples:

- host placeholder conventions
- callback URL conventions
- email placeholder conventions
- bearer token formatting
- explicit examples of fake domains and fake credentials

Source area:

- [`common-work.md:196`](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/agent/common-work.md#L196)

Why demote:

- These are quality checks, not routing rules.
- The main agent should keep only one high-level rule:
  - do not invent concrete hosts, identities, or credentials without source authority
- The detailed blacklist belongs in delivery verification or a dedicated checker script.

### C. Markdown-first `.docx` generation strategy

Source area:

- [`common-work.md:152`](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/agent/common-work.md#L152)
- [`common-work.md:281`](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/agent/common-work.md#L281)

Why demote:

- This is a strong default, but it is still a strategy choice.
- It should remain visible, but not dominate the whole main prompt.
- A shorter version can remain in the main prompt, with details moved elsewhere.

### D. Fine-grained routing suggestions

Examples:

- when to use `doc-coauthoring`
- when to use `doc-normalize`
- when to use `writing-plans`
- when to use `systematic-debugging`
- when to use `verification-before-completion`

Source area:

- [`common-work.md:252`](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/agent/common-work.md#L252)

Why demote:

- The current route table is useful, but it is more routing policy than core identity.
- The main prompt only needs a compressed route rule.

## Can Merge Or Remove

These rules are mostly duplicates, overly concrete incident patches, or examples that can be represented more compactly.

### A. Repeated anti-rediscovery / anti-retry phrasing

Examples:

- do not rediscover after precise paths are known
- do not keep using `glob`
- do not repeat failed `write`
- do not retry the same failing route
- do not re-scan the workspace after entering extraction/drafting

Source areas:

- [`common-work.md:17`](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/agent/common-work.md#L17)
- [`common-work.md:61`](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/agent/common-work.md#L61)
- [`common-work.md:216`](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/agent/common-work.md#L216)

Merge target:

- one compact “do not repeat discovery or failed routes once precise paths/state already exist” rule

### B. Large explicit bad-string lists

Examples:

- `example.com`
- `ops-team@example.com`
- `https://<APP_HOST>/...`
- `Bearer <access_token>`
- `YourSecurePassword123!`

Source area:

- [`common-work.md:240`](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/agent/common-work.md#L240)

Merge target:

- keep one high-level anti-fabrication rule in the prompt
- keep the concrete blacklist in the checker script

### C. Overly specific tool wording

Examples:

- long descriptions of when `grep` tool is forbidden
- repeated distinctions between `bash grep` and `grep`
- multiple similar `/tmp` cautions

Source areas:

- [`common-work.md:102`](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/agent/common-work.md#L102)
- [`common-work.md:39`](/Users/storm/Documents/code/studyProject/opencode-docx/openwork/.opencode/agent/common-work.md#L39)

Merge target:

- one path/tool discipline rule:
  - keep intermediate files inside `<WORKSPACE>`
  - prefer exact-path shell operations over broad tools when you already know the target

## Recommended Reduced Main Prompt Shape

The main prompt should ideally collapse into 6 short sections:

1. Role and scope
2. Workspace boundary
3. Read real files early
4. Prefer state and existing text surfaces
5. Resolve authority before drafting
6. Verify before declaring completion

Everything else should be either:

- a shorter sub-bullet under one of those
- moved to verifier/checker logic
- moved to helper prompts or bridge logic

## Concrete Reduction Strategy

### Keep in `common-work.md`

- workspace-only boundary
- `.tmp` is intermediate only
- read real files early
- prefer `.worktree/index.json` / `manifest.json`
- prefer `.worktree/text/*.txt` over re-extracting binaries
- identify authority source and target doc
- maintain recoverable state
- verify before completion

### Move out of the main prompt

- detailed search-policy micro-rules
- detailed fake-host / fake-email / fake-token examples
- long API placeholder hygiene lists
- detailed routing matrix for optional skills

### Merge into fewer rules

- anti-rediscovery
- anti-repeat-failure
- path safety
- final delivery hygiene

## Recommendation

Do not do a blind line-cut reduction.

Instead:

1. rewrite the file as a smaller constitutional prompt
2. preserve only the hardest boundaries and workflow rules
3. explicitly move detailed quality checks to verifier/checker layers

That should improve compliance more than another round of adding rules, because the model will have fewer competing instructions and a clearer execution priority.
