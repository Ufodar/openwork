# RAGFlow Knowledge Integration Design

## Status

Approved design for a stable `v1`.

This revision replaces earlier draft assumptions that Phase 1 should:

- create a hidden knowledge base for every session
- rely on frontend pre-retrieval before prompt send
- expose custom OpenWork parsing presets on day one

Stable `v1` intentionally keeps the scope smaller so the first user-facing release is predictable, debuggable, and cheap to operate.

## Goal

Integrate RAGFlow into OpenWork so users can:

- create and manage personal knowledge bases outside sessions
- upload files into those knowledge bases
- rely on RAGFlow parsing and chunking with a safe default configuration
- choose zero or more knowledge bases per session
- let the agent search only the selected knowledge bases
- use retrieved evidence to narrow where OpenWork should inspect original files with `docx`, `pdf`, `xlsx`, and `pptx` skills

The integration must avoid the two behaviors that would most damage trust:

- implicit "search everything I can access" retrieval
- a hidden background retrieval path that users cannot understand from the tool timeline

## Stable v1 Scope

Phase 1 includes:

- session-external knowledge base creation and management
- file upload into a knowledge base
- server-side tracking of knowledge ownership and display metadata
- session-level attachment of zero or more knowledge bases
- an OpenWork-owned knowledge tool bridge for the runtime
- retrieval against explicit RAGFlow `dataset_ids`

Phase 1 does not include:

- session-private hidden knowledge bases
- automatic indexing of files uploaded only for one session
- a full embedded RAGFlow admin console
- custom OpenWork parsing presets beyond passing through RAGFlow's own options
- frontend pre-retrieval that injects retrieved chunks into the prompt before the agent asks for them

## Product Rules

### Ownership

- A knowledge base is a user-level asset in OpenWork.
- Each OpenWork user can create multiple knowledge bases.
- OpenWork is the source of truth for ownership.
- Ownership is recorded as:
  - `ownerUserId`
  - `ownerDisplayName`
- RAGFlow tenant metadata is not treated as the product source of truth because all OpenWork users share one RAGFlow service credential.

### Visibility

- `v1` uses a flat visibility model.
- Users can see:
  - their own knowledge bases
  - other users' knowledge bases
- Non-owned knowledge bases must show the owner inline.
- The picker defaults to `Mine` and allows switching to `Others`.
- There is no owner drill-down page in `v1`.

### Session behavior

- A new session starts with no attached knowledge base.
- Knowledge selection is optional.
- If the user selects nothing, OpenWork treats the session as "no knowledge retrieval".
- The attachment set belongs to the session, not the knowledge base.
- Users can change the attachment set between turns.
- Changes apply only to subsequent prompts.
- While a run is active, the picker is read-only.

### Agent behavior

- The agent must never search all accessible RAGFlow datasets by default.
- The agent may only search the session's attached knowledge bases.
- If the session has at least one attached knowledge base, OpenWork should guide the runtime to call the knowledge tool at least once before giving a grounded answer.
- After the first search, the agent may decide whether to search again.
- Retrieval must remain visible in the timeline as an explicit tool call.
- OpenWork must not silently inject retrieved chunks into the prompt before the tool is called.

## Ground Truth From RAGFlow

The design has to respect how RAGFlow works today.

### 1. RAGFlow's HTTP API is the correct backend boundary

RAGFlow already supports:

- dataset creation and listing
- document upload
- parsing and chunking configuration
- retrieval with explicit `dataset_ids`

That makes the HTTP API the right backend boundary for OpenWork.

### 2. RAGFlow's MCP is the wrong product boundary

RAGFlow's MCP keeps dataset scope inside its own MCP session state and can fall back to searching all accessible datasets.

That is incompatible with OpenWork's safety rule that a new session starts with no selected knowledge bases and should not retrieve from anything unless the user chose it.

### 3. Parsing can be slow for large files

Large documents can take a long time to parse and chunk in RAGFlow.

Because of that, `v1` explicitly avoids:

- auto-creating a per-session hidden knowledge base
- auto-indexing every uploaded session file into RAGFlow

Session files remain ordinary working documents unless the user intentionally uploads them into a long-lived knowledge base.

## Recommended Architecture

The recommended architecture has five layers:

1. OpenWork Knowledge Registry
2. OpenWork Knowledge Management APIs
3. OpenWork Session Attachment Store
4. OpenWork-owned runtime knowledge bridge
5. RAGFlow HTTP API

RAGFlow remains the parsing, indexing, and retrieval engine.

OpenWork owns:

- who a knowledge base belongs to
- how knowledge bases are displayed in the UI
- which knowledge bases are attached to a session
- what the runtime is allowed to search
- whether the user selected none, one, or many knowledge bases

## Data Model

### Knowledge registry

OpenWork stores authoritative knowledge metadata in its own registry.

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
- `chunkMethod`
- `parserConfig`
- `embeddingModel`
- `status`
  - `processing`
  - `ready`
  - `degraded`
  - `deleted`
- `documentCount`
- `chunkCount`
- `createdAt`
- `updatedAt`

The registry is the product source of truth for display names and ownership.

### Dataset identity

Because all users share one RAGFlow API key, OpenWork must not use the human-entered title as the backend identity.

Instead:

- OpenWork generates a stable internal dataset name such as `ow_<knowledgeId>`
- OpenWork stores the user-visible title in the registry
- OpenWork maps `knowledgeId -> ragflowDatasetId`

This avoids collisions and makes ownership explicit on the OpenWork side.

### Session attachment store

Session attachment state is separate from knowledge ownership.

Each entry includes:

- `workspaceId`
- `sessionId`
- `runtimeId`
- `knowledgeIds[]`
- `updatedAt`

The attachment store is the authoritative runtime scope.

## Parsing and Chunking Policy

OpenWork should not invent a custom preset system in `v1`.

For `v1`:

- parsing and chunking are configured using RAGFlow's own supported options
- the default is:
  - general document parsing
  - `2000` character chunking

OpenWork must preserve the raw backend configuration in the registry so later versions can expose a richer UI without migrating the data model.

## Knowledge Management Flow

### Create a knowledge base

1. The user opens a knowledge management surface outside any session.
2. The user enters:
  - title
  - description
  - parsing/chunking options
3. OpenWork creates a RAGFlow dataset using the shared service credential.
4. OpenWork writes the resulting mapping into its registry under the current user.

### Upload files

1. The user uploads one or more files to the knowledge base.
2. OpenWork forwards the files to the corresponding RAGFlow dataset.
3. OpenWork tracks parsing state through the registry and any supporting status routes.
4. Until parsing is complete, the knowledge base is not considered ready for retrieval.

### Ready state

A knowledge base is searchable only when:

- the OpenWork registry record exists
- the mapped RAGFlow dataset exists
- parsing is complete enough for retrieval
- the registry status is `ready`

## Session Flow

1. The user opens or creates a session.
2. The session starts with no attached knowledge.
3. The user opens the knowledge picker.
4. `Mine` loads first.
5. The user may switch to `Others`.
6. The user selects zero or more knowledge bases and saves.
7. OpenWork writes the session attachment store.
8. The session UI shows the selected set in a compact strip.
9. While a run is active, editing is disabled.

## Runtime Retrieval Flow

1. OpenWork provisions a session runtime directory.
2. OpenWork adds a session-scoped knowledge bridge to the runtime.
3. The runtime sees only OpenWork's knowledge tools, not raw RAGFlow credentials.
4. When the agent calls the knowledge tool:
  - OpenWork resolves the current session attachment set
  - OpenWork validates that any requested subset is already attached
  - OpenWork translates `knowledgeIds` into `ragflowDatasetId`s
  - OpenWork calls RAGFlow retrieval with explicit `dataset_ids`
5. OpenWork returns normalized results to the runtime with:
  - `knowledgeId`
  - `knowledgeTitle`
  - `ownerUserId`
  - `ownerDisplayName`
  - source document metadata from RAGFlow

## Why Retrieval And File Skills Should Both Exist

RAGFlow is not the final authority for exact document facts. It is the narrowing layer.

Recommended usage model:

- RAGFlow performs coarse recall:
  - likely document
  - likely section
  - likely chunk
- OpenWork file skills perform precise inspection on the original source files when the answer needs:
  - exact wording
  - exact table values
  - exact sheet/cell references
  - exact page/slide anchors

This lets the agent avoid reading entire large files when retrieval can narrow the search area first.

The important point is not "line numbers" specifically, because many Office formats do not expose stable human line numbers. The stable mental model is source anchors:

- PDF: page and layout position
- DOCX: heading path and paragraph sequence
- XLSX: sheet and cell range
- PPTX: slide and text block

## Authorization Rules

OpenWork server is the authority for what a user may see, attach, and search.

Required checks:

- `Mine` only returns records where `ownerUserId` matches the caller
- `Others` only returns records where `ownerUserId` differs from the caller
- attach requests must reject unknown, deleted, or non-ready `knowledgeIds`
- explicit `knowledge_ids` in a search request must be a subset of the current attachment set
- search results must use OpenWork titles and owner metadata, not raw RAGFlow display assumptions

## Failure Model

### No knowledge selected

- `knowledge_list_attached` returns an empty list
- `knowledge_search` returns `no_attached_knowledge`
- the session continues normally
- the agent should answer without knowledge retrieval rather than hallucinating that retrieval happened

### Parsing still in progress

- the picker can show the knowledge base but must mark it unavailable
- the user cannot attach it for retrieval until it is ready

### RAGFlow retrieval failure

- the knowledge tool fails visibly in the timeline
- the prompt send path does not fail just because retrieval failed
- the user sees a retrieval-specific error, not a generic session failure

### Registry drift

If a registry record points to a missing or unusable RAGFlow dataset:

- OpenWork marks the knowledge base `degraded`
- the knowledge base is not attachable until repaired
- the UI shows that it needs repair

## Functional Requirements

### FR1

Knowledge bases are created and managed outside sessions.

### FR2

Each OpenWork user can own multiple knowledge bases.

### FR3

All users share one RAGFlow API key, but ownership is enforced by OpenWork metadata.

### FR4

The default parsing/chunking configuration is RAGFlow general document parsing with 2000-character chunks.

### FR5

Sessions start with no attached knowledge bases.

### FR6

Users may attach zero or more knowledge bases to a session.

### FR7

If no knowledge base is attached, OpenWork does not attempt knowledge retrieval.

### FR8

If one or more knowledge bases are attached, the runtime uses only the selected set for retrieval.

### FR9

Every retrieval request sent to RAGFlow must explicitly specify `dataset_ids`.

### FR10

The runtime must retrieve knowledge through an OpenWork-owned bridge, not direct frontend pre-retrieval and not direct RAGFlow MCP scope.

### FR11

Retrieved evidence is used to narrow the search area; exact confirmation can still fall back to original-file skills.

## Acceptance Checks

1. A user can create a knowledge base outside any session and upload files to it.
2. The created knowledge base appears under `Mine` with the correct owner metadata.
3. A second user can see that knowledge base under `Others` with the owner labeled inline.
4. A new session opens with no attached knowledge by default.
5. If the user attaches nothing, the session runs without knowledge retrieval.
6. If the user attaches one or more knowledge bases, retrieval uses only the selected knowledge bases.
7. The tool timeline shows explicit knowledge tool usage instead of hidden prompt pre-injection.
8. A RAGFlow outage or parsing failure produces a scoped knowledge failure, not a full session failure.

## Final Recommendation

The correct stable `v1` is:

- session-external knowledge base management
- session-level optional attachment
- OpenWork-owned ownership and scope
- OpenWork-owned runtime knowledge bridge
- RAGFlow HTTP API as the backend engine
- explicit `dataset_ids` on every retrieval
- no session-private hidden knowledge bases
- no frontend pre-retrieval

This gives OpenWork a stable first release with a clean path to later improvements without paying the operational cost of indexing every session's transient files.
