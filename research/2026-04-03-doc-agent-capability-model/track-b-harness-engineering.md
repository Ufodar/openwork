# Track B: Harness Engineering for Document Agents

## Executive Summary

This report investigates what external structures (harnesses) make AI agents produce better documents. The central thesis, drawn from the project owner's insight, is that **harness engineering is not just support infrastructure -- it IS part of the capability**. A "flow support harness" (keep running, recover, don't interrupt) is already built in this project. What is missing is a **capability amplification harness** -- external structure that makes the model more likely to do the right thing.

After researching frontier agent systems (Anthropic, OpenAI, METR, Devin, Cursor, Claude Code), academic scaffolding literature, and auditing the current OpenWork codebase, this report identifies seven harness dimensions and provides specific recommendations for each.

**Key finding:** The current system has invested heavily in process-oriented state management (phases, receipts, durable artifacts) but lacks the harness components that most directly amplify model capability: task modeling, curated observation surfaces, quality judgment loops, and scenario-specific knowledge injection. The MCP tools and skill files are well-intentioned but sit at the wrong abstraction level -- they describe *what the model should do* rather than *structuring the environment so the model naturally does it*.

---

## Part 1: Frontier Agent Harness Patterns

### 1.1 Anthropic -- "Building Effective Agents"

Anthropic's guide (anthropic.com/engineering/building-effective-agents) is the most directly relevant reference. Key harness design principles:

**Start simple, add complexity only when measurable.** The most successful agent implementations use simple, composable patterns rather than complex frameworks. This directly challenges the current system's multi-phase orchestration approach.

**Five workflow patterns, ordered by complexity:**

1. **Prompt chaining** -- sequential LLM calls with programmatic gates between steps. *Harness insight:* The gate between steps is the harness -- it checks whether the output meets criteria before passing to the next step.

2. **Routing** -- classify input, then dispatch to specialized handlers. *Harness insight:* The classifier IS the harness. It prevents the wrong prompt from seeing the wrong input.

3. **Parallelization** (sectioning + voting) -- independent subtasks run simultaneously. *Harness insight:* Separating concerns into parallel tracks prevents one consideration from crowding out another in the context window.

4. **Orchestrator-workers** -- central LLM dynamically breaks down tasks and delegates. *Harness insight:* The orchestrator's prompt engineering and the worker contracts define what each agent sees and does.

5. **Evaluator-optimizer** -- one LLM generates, another evaluates in a loop. *Harness insight:* The evaluation criteria and the feedback format ARE the capability harness. Without well-designed evaluation prompts, the loop degrades into rubber-stamping.

**Agent-Computer Interface (ACI) design:** Anthropic explicitly states they spent more time optimizing tools than overall prompts for SWE-bench. Key ACI principles:
- Give the model enough tokens to "think" before it writes itself into a corner
- Keep formats close to what the model has seen in training data
- No formatting overhead (don't require accurate line counts, string escaping)
- Poka-yoke tools -- design arguments so mistakes are structurally impossible
- Test tool usage extensively; iterate on tool descriptions like you would a junior developer's docstring

**Critical finding for this project:** The document-writer agent (`.opencode/agent/document-writer.md`) implements an orchestrator-workers pattern. But Anthropic warns that orchestrator-workers should only be used "for complex tasks where you can't predict the subtasks needed." For document tasks where the phases ARE predictable (intake -> evidence -> compose -> verify), a **prompt chaining** pattern with programmatic gates would be simpler and more reliable.

### 1.2 OpenAI -- "A Practical Guide to Building Agents"

OpenAI's guide emphasizes:

**Single-agent first.** Start with a single agent and only add more when you've proven the single agent can't handle the task. Multi-agent systems add coordination overhead and debugging complexity.

**Tool design as capability surface:** Tools should be designed with clear names, descriptions, and parameter schemas. The model's ability to use a tool correctly is directly proportional to how well-designed the tool interface is.

**Guardrails as parallel harness:** Run guardrail checks in parallel with the main agent, not sequentially. This prevents guardrail overhead from slowing the agent while still catching problems.

**Handoff patterns:** When multiple agents are needed, use explicit handoff protocols rather than implicit coordination. Each agent should have a clear contract for what it receives and what it returns.

**Implication for this project:** The current system uses 6 hidden subagents (doc-intake, doc-reader, doc-merger, doc-planner, doc-writer, doc-verifier) orchestrated by document-writer. OpenAI's guidance suggests this may be over-decomposed. A single agent with phase-appropriate prompts (loaded dynamically) could be simpler and more effective.

### 1.3 METR -- Long-Task Agent Performance

METR's research (metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/) provides the most important empirical data:

**Task length is the key predictor of failure.** Current frontier models (as of early 2025) can reliably complete tasks that take humans up to a few minutes, but succeed less than 10% of the time on tasks taking humans more than ~4 hours. The 50% reliability threshold is around 1 hour of human-equivalent work.

**Doubling time of ~7 months.** The length of tasks models can complete at 50% reliability has been doubling every ~7 months. This means harness engineering should target the gap between current capability (minutes-to-an-hour) and the coming capability frontier.

**Key implication:** A document task that would take a human 4+ hours (e.g., writing a full technical proposal from multiple source documents) is currently at <10% reliability for autonomous completion. The harness must either:
- **Decompose** the task into sub-hour chunks that the model can reliably complete, OR
- **Provide checkpoints** where human judgment re-steers, OR
- **Accept** lower reliability and invest in verification

**Error compounding is the primary failure mode.** Agents don't fail because they can't do individual steps -- they fail because errors compound across steps. Each step has a small probability of error, but over many steps these compound multiplicatively. The harness must interrupt error chains.

### 1.4 Claude Code / Cursor / Devin -- Coding Agent Harness Design

These production coding agents share common harness patterns:

**Primitive tools, not domain abstractions.** Claude Code uses: Read, Edit, Write, Bash, Glob, Grep. NOT "refactor function" or "add test." The model composes primitives into domain actions. The tool descriptions are heavily engineered (e.g., Claude Code's Read tool description includes specific guidance about line numbers, offsets, file types).

**Curated observation surface.** Claude Code doesn't dump the entire codebase into context. It provides search tools (Glob, Grep) that let the model pull in what it needs. The model decides what to observe based on the task.

**Persistent working state.** Claude Code maintains a CLAUDE.md file that persists across sessions. This is a control-fact file, not a process trace. It tells the model "here's what matters NOW" rather than "here's what happened."

**Sandboxed execution.** Tools run in a sandbox with explicit permission levels. This is a safety harness, but it also helps capability: the model doesn't need to worry about accidentally destroying state.

**Context window management.** Claude Code automatically compresses prior messages as conversations approach context limits. This is a critical harness feature -- it prevents the model from losing access to early instructions as the conversation grows.

### 1.5 Academic Scaffolding Research

Lilian Weng's "LLM Powered Autonomous Agents" survey (lilianweng.github.io/posts/2023-06-23-agent/) identifies three components of agent scaffolding:

1. **Planning** -- Task decomposition (CoT, Tree of Thoughts, ReAct) and self-reflection (Reflexion)
2. **Memory** -- Short-term (context window) and long-term (external vector stores)
3. **Tool Use** -- External API access extending model capabilities

Key academic findings relevant to document agents:
- **ReAct** (Reasoning + Acting) outperforms Act-only baselines. The model needs space to reason about what to do before doing it.
- **Reflexion** uses dynamic memory and self-reflection to improve reasoning. Failed trajectories plus ideal reflections are stored as working memory (up to 3 examples). This is directly applicable to document verification.
- **Generative Agents** (Park et al. 2023) use a memory stream + retrieval model + reflection mechanism. The retrieval model surfaces context based on relevance, recency, and importance. This is the observation surface harness.

**Three fundamental challenges identified:**
1. Finite context length limits historical information inclusion
2. Long-term planning and task decomposition remain challenging -- models struggle to adjust plans when facing unexpected errors
3. Reliability of natural language interfaces -- formatting errors and "rebellious behavior" are common

---

## Part 2: Task Modeling Harness

### 2.1 The Problem

The current system expects the user to provide a task, then routes through phases (intake -> evidence -> compose -> verify). But the gap between "user says something" and "system has a well-formed internal task representation" is where most failures originate.

**What frontier systems do:**

**GPT-Engineer's clarification loop:** Before any code generation, GPT-Engineer enters a clarification conversation where it asks one question at a time until the task is sufficiently specified. This is a task modeling harness -- it converts vague input into structured requirements.

**Anthropic's routing pattern:** Classify the input first, then dispatch to the right handler. The classification itself is a task modeling step.

**HuggingGPT's task parsing:** Decomposes user input into structured task objects with explicit fields: task type, ID, dependencies, and arguments. This forces the model to formalize the task before executing it.

### 2.2 What a Document Task Model Should Contain

Based on research, a well-formed document task should have:

| Field | Description | Source |
|-------|-------------|--------|
| `task_type` | Classification: create-new, revise-existing, extract-info, compare, summarize, format-convert | Routing pattern |
| `target_doc` | The specific deliverable (path, format, name) | Current system has this |
| `source_docs` | Input materials with authority ranking | Current system has this partially |
| `quality_criteria` | Explicit, measurable criteria for success | **MISSING** |
| `constraints` | Hard constraints (format, length, terminology, audience) | Partially in skills |
| `scope` | What sections/aspects to touch, and what to leave alone | **MISSING** |
| `acceptance_test` | How the user will judge the result | **MISSING** |

### 2.3 Current System Audit

The current `.worktree/index.json` stores:
- `version`, `project`, `phase`, `target_doc`, `current_focus`, `summary`

**What's missing:**
- `task_type` -- the system doesn't classify what kind of document task this is
- `quality_criteria` -- no explicit success criteria
- `scope` -- no boundaries on what to change and what to preserve
- `acceptance_test` -- no way for the system to know when it's done

The `document-writer.md` agent prompt (line 46-48) requires delegated prompts to contain "Current user objective", "allowed input files", "required first action", "acceptance criteria", and "stop conditions." This is a good contract format, but it's specified as a prompt instruction rather than enforced by the harness. The model may or may not follow it.

### 2.4 Recommendations

1. **Add a task clarification step** before phase routing. When the user's input is ambiguous (no explicit target doc, no clear task type), run a single-turn clarification that produces a structured task object. This should be a programmatic gate, not a prompt instruction.

2. **Formalize the task schema** in `.worktree/index.json` to include `task_type`, `quality_criteria`, `scope`, and `acceptance_test`. These fields should be populated during intake and used by downstream phases.

3. **Infer rather than ask** where possible. If the user provides a source document and says "write a technical proposal," the system should infer task_type=create-new, target_format=.docx, and populate quality criteria from the document-compose skill. Only ask when the inference is ambiguous.

---

## Part 3: Observation Surface Harness

### 3.1 What the Model Sees Determines What It Does

The observation surface is the set of information available to the model at decision time. This is distinct from RAG (which retrieves relevant chunks) -- observation surface design is about **curating what the model sees to make it more likely to succeed**.

**Key insight from Claude Code:** The model doesn't see the whole codebase. It sees search results from tools it invokes. The harness provides the search tools, and the quality of those tools determines the quality of the model's decisions.

**Key insight from Generative Agents:** The retrieval model uses three factors: relevance, recency, and importance. This is a designed observation surface -- not everything in memory is equally visible.

### 3.2 Current System Audit: MCP Tools

The current MCP tools (`document-state-mcp.ts`, lines 117-128) expose seven read-only tools:

| Tool | What it returns |
|------|----------------|
| `state_get_brief` | index.json contents (phase, target_doc, summary) |
| `state_list_sources` | List of source doc IDs with claim/gap counts |
| `state_get_doc` | Full content of one source record |
| `state_get_facts` | Merged facts payload |
| `state_get_conflicts` | Conflict list |
| `state_get_plan` | Solution plan |
| `state_get_coverage` | Coverage summary |

**Assessment:** These tools are a **process-state observation surface**, not a **capability amplification observation surface**. They tell the model "where are we in the process" but not:
- "What does the target document currently look like?"
- "What quality problems exist in the current draft?"
- "What did the user's original quality criteria say?"
- "What sections have been verified and what haven't?"

The tools also don't provide any **summarization or prioritization**. `state_get_facts` returns the entire facts payload. For a large document with many sources, this could consume most of the context window on a single tool call.

### 3.3 Phase Inference Logic

The phase inference in `document-state.ts` (lines 48-60) uses file existence as the signal:

```typescript
if (await exists(join(runtimeDir, ".worktree", "verify", "coverage.json"))) return "verify";
if (await exists(join(runtimeDir, ".worktree", "plan", "solution-plan.json"))) return "plan";
if (await exists(join(runtimeDir, ".worktree", "facts.json")) || ...) return "merge";
// ...
```

**Problem:** This is a waterfall-only heuristic. It infers the phase from the *most advanced artifact that exists*, not from *what actually needs to happen next*. If coverage.json exists but is stale (the draft has been revised since verification), the system still says "verify" -- it can't express "re-verify needed."

### 3.4 Recommendations

1. **Add a "current draft summary" tool** that returns: target doc path, word count, section headings, last-modified time, and a brief content summary (first/last paragraph of each section). This gives the model a structural overview without consuming the full context window.

2. **Add a "quality delta" tool** that returns: what has changed since last verification, what sections are unverified, what quality criteria from the task model are unmet. This is the observation surface that drives the evaluator-optimizer loop.

3. **Add token-budget awareness to MCP tools.** Each tool should accept an optional `max_tokens` parameter that controls response length. For `state_get_facts`, this means returning a summary with the option to drill into specific facts.

4. **Replace waterfall phase inference with a condition-based next-action recommender.** Instead of "you are in phase X," return "the following actions are available: [list with rationale]." This lets the model make an informed routing decision rather than being forced into a linear flow.

---

## Part 4: Action Surface Harness

### 4.1 Domain Verbs vs System Verbs

The fundamental design question: should the document agent's tools be **domain verbs** (intake, extract, compare, outline, draft, revise, verify) or **system verbs** (read file, edit file, bash)?

**Evidence from frontier systems:**

| System | Approach | Result |
|--------|----------|--------|
| Claude Code | System verbs (Read, Edit, Bash, Glob, Grep) | Very successful -- model composes primitives |
| Devin | System verbs + environment (shell, browser, editor) | Successful for coding tasks |
| HuggingGPT | Domain verbs (task-specific model selection) | Works but requires extensive tool catalog |
| Anthropic SWE-bench | System verbs with heavily engineered ACI | Best results came from tool optimization |
| AutoGPT | Mixed (Google Search, Browse, Read/Write File) | Unreliable -- too many choices, poor descriptions |

**The pattern:** Successful agent systems use **system verbs with heavily engineered descriptions**. They do NOT use domain-specific abstractions as the primary tool layer.

**Why this matters for document agents:** The current system's skills (document-intake, document-evidence, document-compose, document-verify) function as **procedure documentation**, not as tools. They tell the model "here's how to do intake" but the model still uses system verbs (read, edit, bash) to execute. The skills are prompt injections, not action surface harness.

### 4.2 Current Skills Audit

Reading each skill file:

**document-intake** (`SKILL.md`, 30 lines):
- Describes what artifacts to produce (`.worktree/index.json`, `.worktree/sources/manifest.json`)
- Lists necessary actions (identify source files, record workspace paths, flag blockers)
- Specifies working method (read metadata and short excerpts, don't do deep reading)
- Has stop conditions

**Assessment:** This is a procedure description, not a tool. It tells the model what to do in prose. The model still needs to figure out HOW to do each step using system verbs. This is fine for capable models, but it doesn't provide any structural advantage -- the model could ignore any of these instructions.

**document-evidence** (`SKILL.md`, 36 lines):
- Describes artifacts (`.worktree/text/<doc-id>.txt`, `.worktree/facts.json`)
- Lists working methods (reuse existing text, one source at a time, preserve provenance)
- Has don't-do rules (don't draft final deliverable, don't push background noise into facts)

**Assessment:** Same pattern. Good procedural guidance. But no structural enforcement. The "one source at a time" rule is a prompt instruction, not a harness constraint. A harness would make it structurally impossible to process multiple sources simultaneously.

**document-compose** (`SKILL.md`, 33 lines):
- Lists inputs (template, facts, coverage, text copies)
- Delivery discipline (maintain stable editable source, don't mix verification with drafting)
- Working method (only modify requested sections, treat user headings as hard constraints)

**Assessment:** The "treat user headings as hard constraints" instruction is the closest thing to quality criteria in the current system. But it's a prompt instruction, not a harness-enforced constraint.

**document-verify** (`SKILL.md`, 33 lines):
- Priority checks (file exists, headings align, facts hold, gaps preserved)
- Artifacts (reports/verify.md, reports/verify.json, .worktree/coverage.json)
- Working method (reopen deliverable, don't rely on session memory)
- Routing logic (local fixes -> compose; fact problems -> evidence)

**Assessment:** This is a **checklist runner**, not a quality judgment harness. It checks structural properties (does the file exist? do headings align?) but doesn't assess substantive quality (is the argument compelling? is the evidence well-synthesized? is the tone appropriate for the audience?). See Part 5 for detailed analysis.

### 4.3 Recommendations

1. **Keep system verbs as the primary action surface.** Don't create domain-specific tools like "draft_section" or "extract_facts." The model is better at composing read/edit/bash than at using bespoke domain tools, and system verbs are already well-understood from training data.

2. **Redesign skills as structured pre-flight checklists rather than prose procedures.** Instead of paragraphs describing what to do, provide:
   - A structured input validation (what must exist before this skill activates)
   - A structured output schema (what must exist after this skill completes)
   - Machine-checkable gates between steps

3. **Add a "commit" action** -- when the agent finishes a phase, it writes a structured receipt that the harness validates before allowing the next phase. This turns the prompt instruction "produce these artifacts" into a harness-enforced gate.

4. **Consider a "workspace diff" tool** that shows what changed in `.worktree/` since last checkpoint. This gives the model an efficient observation of its own recent actions without re-reading everything.

---

## Part 5: Quality Judgment Harness

### 5.1 Verification vs Quality Judgment

The current system conflates two different things:

| Dimension | Verification | Quality Judgment |
|-----------|-------------|-----------------|
| Question | "Did I follow the spec?" | "Is this actually good?" |
| Method | Checklist against requirements | Rubric-based assessment against standards |
| Skill needed | Pattern matching | Domain expertise + taste |
| Current system | document-verify (exists) | **NOT BUILT** |

### 5.2 How Frontier Systems Handle Quality

**Constitutional AI / Self-Critique Pattern (Anthropic):** The model generates a response, then critiques its own response against a set of principles (the "constitution"). The critique is used to revise the response. This is not the same as self-verification -- it's applying external standards to judge quality.

**Evaluator-Optimizer Pattern (Anthropic's workflow guide):** One LLM generates, another evaluates. This works when:
1. LLM responses can be demonstrably improved when a human articulates feedback
2. The LLM can provide such feedback

**Key insight:** The evaluator needs different prompting than the generator. The evaluator should be prompted with quality rubrics, not with the task instructions. A good evaluator prompt includes examples of good and bad output, and explains WHY they are good or bad.

**Reflexion (academic):** Stores failed trajectories + ideal reflections as working memory. When the agent encounters a similar situation, it can access prior failure analysis. This is self-improvement over time, not just single-pass verification.

**Professional editing checklists:** Real document editors use layered review:
1. **Structural review** -- Does the document have the right sections? Is the flow logical?
2. **Factual review** -- Are claims supported? Are sources cited correctly?
3. **Coherence review** -- Do sections connect? Is the argument consistent?
4. **Audience review** -- Is the tone appropriate? Is the technical level right?
5. **Polish review** -- Grammar, style, formatting consistency

### 5.3 Current System Audit: document-verify

The current `document-verify/SKILL.md` checks:
- File exists at stable path
- Headings and section boundaries align
- Main facts, citations, and evidence hold
- Known gaps, conflicts, and blockers are preserved

**What it doesn't check:**
- Is the argument compelling and well-structured?
- Is the evidence well-synthesized (not just present but well-integrated)?
- Is the tone appropriate for the stated audience?
- Are there logical gaps or non-sequiturs?
- Is the document internally consistent (no contradictions between sections)?
- Does it meet the quality standard for the document type (proposal, report, brief)?

**The fundamental gap:** document-verify is a **completeness checker**, not a **quality judge**. It can tell you "all sections are present" but not "section 3 is weak because the evidence doesn't support the conclusion."

### 5.4 Recommendations

1. **Implement the evaluator-optimizer pattern** for document quality. After document-compose produces a draft, run a separate evaluation pass with a quality-judgment prompt that includes:
   - A rubric specific to the document type (proposal, report, brief, etc.)
   - Examples of strong and weak sections with explanations
   - Explicit dimensions to evaluate (argument strength, evidence integration, tone, coherence)

2. **Separate structural verification from quality judgment** into two distinct steps. Structural verification (headings, file existence, coverage) can be largely automated. Quality judgment requires a separate LLM pass with different prompting.

3. **Build quality rubrics per document type** as skill files. A proposal quality rubric is different from a technical report quality rubric. Load the appropriate rubric based on `task_type` from the task model.

4. **Add a "quality delta" feedback loop.** When the quality judge identifies a weakness, it should produce a structured criticism that the composer can act on. Not "section 3 is weak" but "section 3 claims X but only provides evidence for Y; the gap is Z."

5. **Store quality judgments as durable state** (e.g., `.worktree/verify/quality-assessment.json`) so they persist across sessions and can be compared across revision cycles.

---

## Part 6: Recovery Harness

### 6.1 Process Trace vs Control Fact

Two fundamentally different approaches to state:

**Process trace** (history-oriented): "Here's everything that happened." Example: git log, audit trail, conversation history.

**Control fact** (decision-oriented): "Here's what matters NOW for the next decision." Example: Claude Code's CLAUDE.md, a workflow engine's current state.

**How workflow engines handle this:**

| Engine | Approach | Key Design |
|--------|----------|-----------|
| Temporal | Event-sourced process trace, but replay to current state | The "replay" is the control-fact extraction |
| Airflow | DAG state (which tasks completed, which pending) | Control-fact oriented -- only tracks task status |
| Prefect | Flow state + task states | Hybrid -- stores flow results as control facts |

**Key insight from Temporal:** Temporal stores the full event history but uses "replay" to reconstruct current state. The replay is deterministic -- given the same events, you get the same state. This means the process trace IS the control fact (via replay). For an LLM agent, this doesn't work because LLM behavior is non-deterministic. You can't "replay" a conversation and expect the same results.

**Therefore, for LLM agents, explicit control facts are essential.** The agent needs to know "what matters now" without replaying history.

### 6.2 Current System Audit: .worktree/ Structure

The `.worktree/` structure is designed around:

```
.worktree/
  index.json              -- control fact (phase, target, focus)
  sources/
    manifest.json          -- control fact (source inventory)
    <doc-id>.json          -- evidence (extracted claims, gaps)
  text/
    <doc-id>.txt           -- derived artifact (text copies)
  facts.json               -- control fact (merged facts)
  merge/
    conflicts.json         -- control fact (unresolved conflicts)
  plan/
    solution-plan.json     -- control fact (current plan)
  coverage.json            -- control fact (what's covered)
  verify/
    coverage.json          -- control fact (verification state)
```

**Assessment:** This is **mostly control-fact oriented**, which is correct. The structure tells the agent "here's what matters now" rather than "here's what happened." The source JSON files with claims and gaps are control facts (they encode extracted decisions, not raw history).

**However, there are gaps:**

1. **No explicit "what happened last" summary.** When a session resumes, the agent reads `.worktree/index.json` but doesn't know what the previous session accomplished or where it stopped. A `last_action_summary` field would help.

2. **No staleness markers.** If facts.json was generated from sources A and B, but source C has since been added, there's no way for the agent to know that facts.json is stale without re-reading all sources. A hash or timestamp-based freshness check would help.

3. **No "decisions made" record.** When the agent resolves a conflict or makes an ambiguous choice (e.g., "I used source A's figure instead of source B's because..."), this decision isn't recorded. If the session resumes, the agent might re-encounter the same conflict and decide differently.

### 6.3 Minimum Viable State for Resumption

Based on research, the minimum viable control-fact set for correct session resumption is:

1. **Task definition** -- What the user wants (task_type, target_doc, quality_criteria)
2. **Progress marker** -- Which phases are complete with their outputs
3. **Current focus** -- What the agent should work on next
4. **Open decisions** -- Unresolved conflicts, ambiguities, blockers
5. **Freshness map** -- Which artifacts depend on which sources, and whether they're current

The current `.worktree/index.json` covers #1 (partially), #2 (via phase inference), and #3. It does NOT cover #4 or #5.

### 6.4 Recommendations

1. **Add a `decisions.json` file** that records key decisions with rationale. Format: `{ decision_id, what, why, alternative_considered, source_authority }`. This prevents the agent from re-litigating resolved questions on resume.

2. **Add freshness tracking** to `index.json` or a separate `freshness.json`. Each artifact records which inputs it was derived from and their modification times. The harness can then flag stale artifacts on resume.

3. **Add a `resume_brief` field** to `index.json` that the agent writes at the end of each session. This is a one-paragraph summary of "where I stopped and what should happen next." This is a control fact, not a process trace.

4. **Keep the process trace minimal.** Don't add event logs or conversation history to `.worktree/`. The conversation history is in the session; the `.worktree/` should only contain what's needed for the next decision.

---

## Part 7: Scenario Loading Harness

### 7.1 The Problem

The current system has generic document skills (intake, evidence, compose, verify) plus the potential for domain-specific knowledge (bid-writing, technical proposals, etc.). But there's no harness for:
- Deciding WHEN to load a domain skill
- Preventing base prompt pollution from domain-specific content
- Combining multiple skill layers without conflicts

### 7.2 How Plugin/Skill Systems Work in Agent Frameworks

**OpenCode's skill system:** Skills are loaded based on YAML frontmatter `description` field. The system matches the user's task to relevant skills. Each skill is a markdown file with instructions that get injected into the prompt.

**MCP (Model Context Protocol):** Tools are registered with descriptions. The model selects which tools to invoke based on the descriptions. This is a pull-based model -- the model asks for what it needs.

**Anthropic's routing pattern:** Classify the input first, then load the appropriate handler. This is a push-based model -- the harness decides what the model sees.

### 7.3 Layered Skill Architecture

Based on research, a document agent should have three skill layers:

**Layer 0 -- Core capability** (always loaded): Basic document reading, editing, file operations. This is the system verb layer.

**Layer 1 -- Document workflow** (loaded when document task detected): The intake/evidence/compose/verify cycle, `.worktree/` state management, quality criteria templates. This is the current skill set.

**Layer 2 -- Domain specialization** (loaded based on task classification): Bid-writing conventions, technical report standards, regulatory compliance checklists, domain terminology. Loaded ONLY when the task type matches.

### 7.4 Current System Assessment

The current system has Layer 0 (OpenCode primitives) and a partial Layer 1 (the four document skills + using-document-workflows). Layer 2 is planned but not built.

**Risk of base prompt pollution:** The `common-work.md` agent prompt is already 84 lines. The `document-writer.md` prompt is 76 lines. Adding domain-specific skills on top risks consuming too much of the context window on instructions, leaving less room for actual document content.

### 7.5 Recommendations

1. **Implement a skill router** that classifies the task type and loads only the relevant Layer 2 skill. Don't load all domain skills simultaneously. The router should run BEFORE the main agent loop starts.

2. **Keep Layer 1 skills minimal.** The current skills are already concise (30-36 lines each). Don't let them grow. If a skill needs more detail, split it into a brief trigger-description (always loaded) and a detailed procedure (loaded only when activated).

3. **Use structured skill schemas** instead of prose. Instead of a markdown paragraph describing what to do, use a structured format:
   ```yaml
   preconditions:
     - .worktree/index.json exists
     - task_type is "create-new" or "revise-existing"
   outputs:
     - path: .worktree/facts.json
       schema: { facts: array, gaps: array, confidence: number }
   quality_gates:
     - all_sources_processed: true
     - no_unresolved_conflicts: true
   ```
   This is machine-checkable, not just model-interpretable.

4. **Prevent prompt pollution via dynamic loading.** Only inject the active skill's instructions into the prompt. Use the MCP tool pattern: register skills as tools that the model can invoke when needed, rather than pre-loading everything into the system prompt.

---

## Part 8: Synthesis -- The Capability Amplification Stack

Bringing together all seven harness dimensions, here is the recommended capability amplification stack for the document agent:

### The Stack (Bottom to Top)

```
Layer 5: Quality Judgment Harness
         evaluator-optimizer loop, rubric-based assessment, quality delta feedback
         
Layer 4: Scenario Loading Harness  
         skill router, dynamic Layer 2 injection, prompt pollution prevention

Layer 3: Observation Surface Harness
         curated MCP tools, token-budget-aware responses, draft summaries

Layer 2: Action Surface Harness
         system verbs + engineered ACI, structured receipts, commit gates

Layer 1: Task Modeling Harness
         task clarification, structured task schema, infer-before-ask

Layer 0: Recovery Harness
         control-fact state, freshness tracking, decisions.json, resume briefs
         
Foundation: Flow Support Harness (ALREADY BUILT)
            session management, durable state, phase routing, error recovery
```

### Priority Order for Implementation

Based on expected impact and implementation effort:

| Priority | Harness Component | Expected Impact | Effort |
|----------|------------------|-----------------|--------|
| **P0** | Task Modeling (formalize task schema in index.json) | High -- fixes root cause of vague tasks | Low |
| **P0** | Quality Judgment (add evaluator-optimizer loop) | High -- currently no quality feedback | Medium |
| **P1** | Observation Surface (add draft summary + quality delta tools) | High -- model makes better decisions with better observations | Medium |
| **P1** | Recovery (add decisions.json + freshness tracking) | Medium -- prevents wasted work on resume | Low |
| **P2** | Action Surface (structured skill schemas + commit gates) | Medium -- enforces what prompts only suggest | Medium |
| **P2** | Scenario Loading (skill router + dynamic injection) | Medium -- enables domain specialization | Medium |
| **P3** | Prompt simplification (reduce orchestrator to prompt chain) | High but risky -- architectural change | High |

### The Key Architectural Insight

The current system is built as an **orchestrator-workers** pattern (document-writer delegates to doc-* subagents). Based on the research, the most impactful change would be to move toward a **prompt chaining with evaluator-optimizer** pattern:

```
Current:  Orchestrator -> [Intake] -> [Reader] -> [Merger] -> [Planner] -> [Writer] -> [Verifier]
                          (6 subagents, implicit coordination, prompt-based contracts)

Proposed: [Task Model] -gate-> [Evidence] -gate-> [Compose] -gate-> [Quality Judge] -loop->
                          (1 agent, 4 phases, programmatic gates, structured state)
```

The gates between phases are the harness. They:
1. Validate that required artifacts exist and meet schema
2. Check freshness of upstream artifacts
3. Provide the next phase with a curated observation surface
4. Record decisions and receipts

This is simpler (fewer moving parts), more reliable (gates catch errors before they compound), and more transparent (each gate produces a checkable artifact).

---

## Appendix A: Annotated Bibliography

| Source | Key Contribution | URL |
|--------|-----------------|-----|
| Anthropic, "Building Effective Agents" | 5 workflow patterns, ACI design principles, simplicity-first approach | anthropic.com/engineering/building-effective-agents |
| OpenAI, "A Practical Guide to Building Agents" | Single-agent first, tool design, guardrails, handoff patterns | cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf |
| METR, "Measuring AI Ability to Complete Long Tasks" | Task length as key predictor, 7-month doubling time, error compounding | metr.org/blog/2025-03-19-measuring-ai-ability-to-complete-long-tasks/ |
| Lilian Weng, "LLM Powered Autonomous Agents" | Planning/Memory/Tool taxonomy, ReAct, Reflexion, challenges | lilianweng.github.io/posts/2023-06-23-agent/ |
| Park et al., "Generative Agents" (2023) | Memory stream + retrieval model + reflection mechanism | arxiv.org/abs/2304.03442 |
| Shinn & Labash, "Reflexion" (2023) | Dynamic memory + self-reflection for iterative improvement | arxiv.org/abs/2303.11366 |
| Yao et al., "ReAct" (2023) | Reasoning + Acting integration, outperforms Act-only | arxiv.org/abs/2210.03629 |
| Anthropic, "Claude's Character" | Constitutional AI training, self-critique pattern | anthropic.com/research/claude-character |

## Appendix B: Current Codebase File References

| File | Lines | Role in Harness |
|------|-------|-----------------|
| `packages/server/src/document-state.ts` | 1-192 | State reading + phase inference |
| `packages/server/src/document-state-mcp.ts` | 1-227 | MCP tool definitions (observation surface) |
| `packages/server/src/runtime-document-state-tokens.ts` | 1-186 | Auth for MCP access (security harness) |
| `.opencode/agent/document-writer.md` | 1-76 | Orchestrator agent prompt |
| `.opencode/agent/common-work.md` | 1-84 | General document assistant prompt |
| `.opencode/skills/document-intake/SKILL.md` | 1-30 | Intake procedure |
| `.opencode/skills/document-evidence/SKILL.md` | 1-36 | Evidence extraction procedure |
| `.opencode/skills/document-compose/SKILL.md` | 1-33 | Composition procedure |
| `.opencode/skills/document-verify/SKILL.md` | 1-33 | Verification checklist |
| `.opencode/skills/using-document-workflows/SKILL.md` | 1-38 | Workflow routing rules |
