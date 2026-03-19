# RAGFlow Knowledge Integration Design

## Status

Draft design for review. This document defines the product and runtime model before implementation.

## Goal

Integrate RAGFlow into OpenWork so users can use knowledge bases inside any session without:

- forcing frontend pre-retrieval before every message
- requiring separate RAGFlow end-user accounts
- defaulting to unsafe "search all datasets" behavior
- painting the product into a corner before later adding one-stop knowledge-base management inside OpenWork

The design must support:

- user-level knowledge bases
- session-level attachment of zero or more knowledge bases
- changing the attached set between turns in the same session
- agent-controlled retrieval timing and repeated retrieval within a run
- later OpenWork-native flows for create/upload/parse/reparse without redesigning the runtime model

## Phase 1 Non-Goals

Phase 1 is intentionally not trying to solve every knowledge-management problem.

It does not include:

- embedding the full RAGFlow UI inside OpenWork
- rebuilding the entire RAGFlow administration console inside OpenWork
- per-message override UI separate from the session attachment picker
- mutating attachment scope while a run is already in progress
- SQL-based retrieval bypassing RAGFlow's retrieval engine

## Product Rules

### Ownership and visibility

- A knowledge base is a user asset, not a session asset.
- OpenWork does not expose a "team" concept in this feature.
- By default, a user's own knowledge bases are shown first.
- Users can switch to a flat list of other users' knowledge bases.
- Each non-owned knowledge base must show its owner inline.
- There is no owner drill-down page in the picker.

### Session behavior

- A new session starts with no attached knowledge base.
- Knowledge selection is optional.
- The attached set belongs to the current session.
- Users can change the attached set between turns.
- Changes apply to subsequent prompts, not to an already running prompt.
- While a run is active, the knowledge picker should be read-only to avoid mid-run scope races.

### Agent behavior

- Retrieval is a tool the agent decides to call.
- The agent may call retrieval multiple times during one run.
- The agent may search all currently attached knowledge bases or a subset of them.
- OpenWork must never inject retrieved chunks into the prompt before the tool is called.

## Ground Truth From RAGFlow

The design must respect how RAGFlow actually behaves today.

### 1. RAGFlow MCP is not the right product boundary

RAGFlow's MCP server exposes fixed tools such as:

- `ragflow_list_datasets`
- `ragflow_select_datasets`
- `ragflow_get_dataset_scope`
- `ragflow_clear_dataset_scope`
- `ragflow_retrieval`

Its tool descriptions are static. Dataset scope is stored inside the RAGFlow MCP server's own session store.

### 2. Bare RAGFlow retrieval is unsafe for OpenWork defaults

`ragflow_retrieval` uses this precedence:

1. explicit `dataset_ids`
2. MCP session scope
3. all accessible datasets

That third fallback is incompatible with the OpenWork rule that a new session should start with no selected knowledge.

### 3. RAGFlow HTTP API is the stable backend surface

RAGFlow's HTTP API already supports:

- dataset create, list, update, delete
- document upload and status tracking
- parser and chunking configuration
- retrieval with explicit `dataset_ids`

That makes the HTTP API the correct backend surface for OpenWork.

## Approaches Considered

### Approach A: Use RAGFlow MCP directly

This would expose RAGFlow's MCP tools to OpenCode and try to synchronize OpenWork's session picker with RAGFlow MCP session scope.

Pros:

- minimal work on paper
- uses RAGFlow's existing MCP implementation

Cons:

- OpenWork would have to keep UI state and RAGFlow MCP session state perfectly synchronized
- an unsynchronized scope falls back to all accessible datasets
- product semantics would depend on RAGFlow MCP internals instead of OpenWork-owned state
- later OpenWork-native knowledge management would still need a separate ownership model

Decision: reject.

### Approach B: Read RAGFlow storage directly with SQL

This would use SQL for runtime knowledge lookup and metadata access.

Pros:

- direct control over raw records
- useful for diagnostics and migration utilities

Cons:

- bypasses RAGFlow's retrieval stack
- loses hybrid retrieval, rerank, and future backend improvements
- couples OpenWork to RAGFlow internals instead of its supported API

Decision: reject as the main retrieval path. SQL may still be used for admin diagnostics or one-time migration tooling.

### Approach C: OpenWork-owned knowledge layer over RAGFlow HTTP API

This makes OpenWork the owner of product semantics and uses RAGFlow only as the backend engine.

Pros:

- OpenWork controls ownership, visibility, defaults, and session scope
- every retrieval can explicitly pass `dataset_ids`
- no dependency on RAGFlow MCP session state
- clean path to later OpenWork-native knowledge management

Cons:

- requires an OpenWork-owned registry and tool bridge
- requires session-scoped runtime wiring for the knowledge tool

Decision: recommended.

## Recommendation

OpenWork should own the full user-facing knowledge model and use RAGFlow's HTTP API as a backend service.

The recommended architecture has four layers:

1. OpenWork Knowledge Registry
2. OpenWork Session Attachment Store
3. OpenWork-owned agent tool bridge
4. RAGFlow HTTP API

RAGFlow remains the parser, indexer, and retriever. OpenWork owns the meaning of:

- who a knowledge base belongs to
- which knowledge bases are visible in the picker
- which knowledge bases are attached to a session
- what the agent is allowed to search in the current session

## End-to-End User Experience

### Phase 1: Use knowledge inside sessions

1. The user opens a session.
2. The session has no attached knowledge by default.
3. The user clicks `Knowledge`.
4. The picker loads the user's own knowledge bases first.
5. The user may switch to a flat list of other users' knowledge bases, each labeled with owner.
6. The user checks one or more knowledge bases and saves.
7. The session now shows the selected knowledge bases in a compact strip.
8. The agent may call the knowledge tool whenever it needs evidence.
9. The agent may call the tool multiple times during the run.
10. Before a later turn, the user may edit the selected set again.

### Phase 2: Manage knowledge inside OpenWork

OpenWork adds a native knowledge management area where users can:

- create a knowledge base
- upload documents
- choose a parsing preset
- optionally tune advanced parser settings
- monitor parsing status
- reparse or delete documents

RAGFlow remains the backend engine. Users do not need separate RAGFlow accounts.

## Architecture

### 1. OpenWork Knowledge Registry

OpenWork stores authoritative knowledge-base metadata in its own registry.

Each record includes:

- `knowledgeId`
- `ragflowDatasetId`
- `ownerUserId`
- `ownerDisplayName`
- `title`
- `description`
- `source`
  - `openwork`
  - `imported`
- `visibility`
  - `visible_to_all_users`
- `ingestionPreset`
- `chunkMethod`
- `parserConfig`
- `embeddingModel`
- `status`
  - `ready`
  - `processing`
  - `degraded`
  - `deleted`
- `documentCount`
- `chunkCount`
- `createdAt`
- `updatedAt`

The registry is the product source of truth for display names and ownership.

### 2. Namespacing and RAGFlow dataset identity

Because OpenWork will use a shared RAGFlow service credential, OpenWork must not rely on user-visible titles as the RAGFlow dataset name.

RAGFlow dataset names are globally unique within that tenant. Therefore:

- OpenWork generates an internal dataset name such as `ow_<knowledgeId>`
- OpenWork stores the user-visible title in its own registry
- OpenWork sets RAGFlow dataset `permission` to `me`
- OpenWork does not rely on RAGFlow tenant or permission metadata for product ownership

This avoids future collisions when multiple users create knowledge bases with similar names.

### 3. OpenWork Session Attachment Store

Session attachment state is separate from knowledge ownership.

Each session record includes:

- `workspaceId`
- `sessionId`
- `runtimeId`
- `knowledgeIds[]`
- `updatedAt`

The attachment store is the authoritative runtime scope.

OpenWork may also mirror a read-only snapshot into the session runtime workspace at:

- `.opencode/openwork.json`

That mirror is for transparency and debugging. It is not the source of truth.

### 4. Authorization rules

OpenWork server is the authority for what a user may see, attach, and search.

Required checks:

- `Mine` only returns registry entries where `ownerUserId` matches the caller
- `Others` only returns registry entries where `ownerUserId` differs from the caller
- attach requests must reject unknown, deleted, or non-visible `knowledgeIds`
- `knowledge_search` with explicit `knowledge_ids` must reject any id that is not in the current session attachment set
- search results must be labeled with OpenWork registry title and owner metadata, not raw RAGFlow display assumptions

### 5. Session-scoped knowledge tool bridge

The agent should not call RAGFlow directly. It should call an OpenWork-owned knowledge tool bridge.

Recommended runtime shape:

- when OpenWork provisions a session runtime workspace, it also provisions a session-scoped knowledge MCP config for that runtime
- that knowledge MCP is not RAGFlow's MCP
- preferred carrier: an OpenWork-owned remote MCP endpoint served by OpenWork server itself
- fallback carrier: an OpenWork-owned local wrapper command if remote MCP proves incompatible with OpenCode runtime behavior
- the carrier receives a runtime-scoped identity, not global product credentials
- the carrier calls back into OpenWork server knowledge endpoints
- OpenWork server then calls RAGFlow HTTP API with explicit `dataset_ids`

This keeps:

- RAGFlow API keys on the server side
- session scope owned by OpenWork
- the agent-facing surface stable even if the RAGFlow backend changes later

Critical guardrail:

- the session-scoped tool wiring must not replace or shadow the parent workspace's existing OpenCode config, skills, or MCPs
- sessions in hosted mode inherit important behavior from the parent workspace, so knowledge tooling must be added as a non-destructive overlay or equivalent launcher mechanism

### 6. Runtime identity for the tool bridge

The tool bridge needs stable session context. The safest design is to bind it to the session runtime identity, not to RAGFlow MCP state.

Recommended mechanism:

- OpenWork generates a short-lived runtime-scoped token during session provisioning
- the token is bound to the session `runtimeId`
- the token is read-only and only allows knowledge operations for that runtime
- the carrier receives the runtime token and `runtimeId`
- OpenWork server resolves the current attachment set from `runtimeId`

This avoids:

- depending on OpenCode passing through foreign MCP session identifiers
- embedding the main OpenWork or RAGFlow service secrets into the agent environment

### 7. Agent-facing tool surface

Phase 1 only needs a small tool surface:

- `knowledge_list_attached()`
  - returns the currently attached knowledge bases with id, title, and owner
- `knowledge_search(query, knowledge_ids?, top_k?, keyword?, metadata_filter?)`
  - if `knowledge_ids` is omitted, search across all currently attached knowledge bases
  - if `knowledge_ids` is provided, it must be a subset of the attached set

Critical rule:

- if no knowledge base is attached, `knowledge_search` must return a structured `no_attached_knowledge` error
- it must never fall back to all accessible RAGFlow datasets

## Data Flow

### Session creation

1. OpenWork provisions `runtimeId` and runtime workspace directory.
2. OpenWork provisions the session-scoped knowledge MCP bridge for that runtime.
3. OpenWork creates the OpenCode session in that runtime directory.
4. The session starts with an empty attachment set.

### Attach knowledge bases

1. User opens the picker.
2. OpenWork loads `mine` by default.
3. If requested, OpenWork loads `others` as one flat list with owner labels.
4. User saves the selected set.
5. OpenWork writes the attachment store entry and optional runtime mirror.

### Agent retrieval

1. Agent decides knowledge is needed.
2. Agent optionally calls `knowledge_list_attached`.
3. Agent calls `knowledge_search`.
4. OpenWork knowledge endpoint resolves the attached set for the runtime.
5. OpenWork translates selected `knowledgeIds` into `ragflowDatasetId`s.
6. OpenWork calls RAGFlow `/api/v1/retrieval` with explicit `dataset_ids`.
7. Results are normalized and returned to the agent with dataset title and owner metadata.

## Knowledge Picker Design

### Initial state

- The session starts with no selected knowledge.
- The picker is closed by default.
- The session strip is absent or shows a neutral "No knowledge selected" state.

### Picker behavior

- Tab or filter default: `Mine`
- Secondary view: `Others`
- `Others` is a single flat list
- Every row in `Others` shows the owner
- Loading should be on-demand so sessions do not pay the cost unless the user opens the picker
- `Others` should support search and pagination without introducing owner drill-down

### Save semantics

- Save replaces the current attached set for the session
- Cancel leaves it unchanged
- While a run is active, editing is disabled or deferred

## Parsing, Chunking, and Future Management

The runtime design must already support later ingestion controls.

### Preset model

OpenWork should define a small set of user-facing presets, for example:

- `general_document`
- `long_report`
- `table_heavy`
- `scan_ocr`
- `web_markdown`

### Advanced settings

The registry must still preserve raw backend settings so OpenWork can later surface advanced controls without schema changes:

- `chunkMethod`
- `parserConfig`
- `embeddingModel`

Examples of parser settings that must remain representable:

- chunk token length
- overlap or delimiter strategy
- OCR/layout mode
- Excel-to-HTML behavior
- Raptor/GraphRAG flags if enabled later

Phase 1 does not need a full advanced UI, but the model must preserve the fields now.

## Migration and Legacy RAGFlow Data

This design assumes OpenWork becomes the owner of product metadata.

That creates one migration requirement:

- datasets that already exist in RAGFlow but were not created by OpenWork need an import or claim flow before they appear cleanly in OpenWork

Therefore:

- OpenWork-managed knowledge bases use the registry from day one
- legacy datasets should be imported into the registry through a one-time sync or claim tool
- until imported, they should not be treated as first-class OpenWork knowledge bases

This prevents hidden ownership ambiguity later.

## Failure Model

### No knowledge attached

- `knowledge_list_attached` returns an empty list
- `knowledge_search` returns `no_attached_knowledge`
- the run continues; the user can attach knowledge before the next turn

### RAGFlow retrieval failure

- the tool call fails visibly in the timeline
- the prompt send path does not fail just because RAGFlow is unavailable
- the user sees a clear retrieval-specific error, not a generic session failure

### Registry drift

If a registry entry points to a missing or deleted RAGFlow dataset:

- the knowledge search returns a structured degraded error
- OpenWork marks the knowledge base `degraded`
- the picker can show that the knowledge base needs repair

### Attachment mutation during a run

- not allowed in Phase 1
- the picker is disabled while the session is actively running

This avoids non-deterministic scope changes during a multi-tool run.

## Why This Does Not Collapse Later

This design intentionally keeps stable boundaries:

- OpenWork owns product semantics
- RAGFlow owns parsing and retrieval internals
- agent tool behavior is session-scoped but backend-agnostic
- session attachments are separate from knowledge ownership
- ingestion settings already have a place in the model

That means later features do not require redesigning the runtime contract:

- OpenWork-native KB create/upload pages
- owner filtering and search
- richer retrieval controls
- imported legacy dataset repair
- additional retrieval backends beyond RAGFlow

## Functional Requirements

### FR1

Knowledge bases are user-level assets in OpenWork.

### FR2

Sessions start with no attached knowledge bases.

### FR3

The picker defaults to showing the current user's own knowledge bases.

### FR4

Users can switch to a flat list of other users' knowledge bases, each labeled with owner.

### FR5

The agent retrieves knowledge through an OpenWork-owned tool surface, not through frontend pre-retrieval.

### FR6

Every retrieval request sent to RAGFlow must explicitly specify `dataset_ids`.

### FR7

If no knowledge base is attached, retrieval must not fall back to all accessible datasets.

### FR8

Knowledge selection changes apply to subsequent prompts, not in-flight prompts.

### FR9

The data model must preserve chunking and parser configuration so OpenWork can later add native knowledge management without migration.

### FR10

OpenWork must be able to use a single shared RAGFlow service credential without exposing separate RAGFlow accounts to end users.

## Acceptance Checks

1. A new session opens with no attached knowledge and the agent cannot accidentally search all datasets.
2. A user can attach one of their own knowledge bases and the agent can search it multiple times in one run.
3. A user can attach another user's knowledge base from the flat `Others` list and still see the owner clearly.
4. A user can change the attached set before a later turn in the same session without creating a new session.
5. A RAGFlow outage produces a tool-level retrieval failure, not a full session outage.
6. Creating a future OpenWork-native knowledge base UI does not require changing the session runtime model.

## Implementation Validation Checkpoints

These are implementation checks, not product-design open questions.

### 1. Session-scoped MCP wiring

Before coding the runtime bridge, verify which OpenCode-supported mechanism can inject the session-scoped knowledge tool without shadowing inherited parent-workspace config:

- runtime-local MCP config overlay
- generated wrapper launcher
- equivalent non-destructive session bootstrap path

The product design does not depend on which carrier wins, only on preserving the session-scoped runtime identity and non-destructive config behavior.

### 2. Legacy dataset import path

Before exposing imported knowledge bases broadly, verify the operational migration flow for existing RAGFlow datasets:

- how an imported dataset is claimed into the OpenWork registry
- how owner metadata is assigned or repaired
- how degraded or duplicate legacy entries are surfaced to admins

This does not change the runtime model. It only affects rollout and backfill.

## Final Recommendation

OpenWork should not rely on RAGFlow MCP session scope and should not use SQL as the runtime retrieval path.

The correct long-term shape is:

- OpenWork-owned knowledge registry
- OpenWork-owned session attachment store
- OpenWork-owned session-scoped knowledge tool bridge
- RAGFlow HTTP API as backend
- explicit `dataset_ids` on every retrieval
- default empty attachment set for new sessions
- picker defaulting to `Mine`, with a flat `Others` view labeled by owner

That gives OpenWork a safe Phase 1 and a clean path to later one-stop knowledge management without another redesign.
