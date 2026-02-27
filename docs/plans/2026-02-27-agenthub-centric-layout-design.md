# AgentHub-Centric Layout Redesign

## Goal

Transform OpenWork into an AI employee workspace where the Agent Hub is the primary entry point. Users select from 3 specialized agents: General Assistant, Document Agent, and Bid Writer. Non-essential navigation items are hidden (not deleted) to keep the codebase reversible.

## Approach

**Method A: Minimal changes** — comment out unused UI elements, modify agents.tsx, create a new document-agent page.

## Changes Summary

### 1. Navigation Hiding

**Files:**
- `packages/app/src/app/pages/dashboard.tsx`
- `packages/app/src/app/pages/session.tsx`

**Right sidebar navigation** — comment out (JSX comment `{/* ... */}`) these items:
- Automations (scheduled)
- Soul
- Skills
- Extensions (mcp)
- Messaging (identities)
- Advanced (config)

**Keep:** Agents only.

**Left sidebar** (conversation history) — no changes.

**Default tab** — change to `"agents"` so the Agent Hub loads on first visit.

**Mobile bottom nav** in dashboard.tsx — comment out the same items.

### 2. Agent Hub (agents.tsx)

**File:** `packages/app/src/app/pages/agents.tsx`

Replace the current featured agents list with 3 fixed cards:

| ID | Name | Description | Icon | Warning | Click → View |
|----|------|-------------|------|---------|-------------|
| `general-assistant` | General Assistant | AI general assistant, can execute system commands | Terminal | "Use with caution: can modify system environment" (orange badge) | `session` |
| `document-agent` | Document Agent | Document viewing, editing, and AI collaboration | FileText | none | `document-agent` |
| `bid-writer` | Bid Writer | Bid document creation with AI assistance | FileText | none | `document-writer` |

Comment out the "Installed agents" section (dynamic agent list from SDK).

### 3. Document Agent Page (NEW)

**New file:** `packages/app/src/app/pages/document-agent.tsx`

Three-panel layout (same structure as document-writer):

```
+---------------------+-------------------+------------------+
| Left: File Manager   | Center: OnlyOffice | Right: Chat     |
| (tree view)          | (document viewer)  | (AI dialogue)   |
| collapsible, resize  | flexible width     | resizable       |
+---------------------+-------------------+------------------+
```

**Left panel — Tree file manager:**
- Displays workspace `documents/` directory as a tree (folders expand/collapse)
- Upload files (drag-and-drop + button)
- Create new folders
- Click file → preview in center OnlyOffice panel
- Right-click context menu: delete, rename
- File icons by extension (.docx/.xlsx/.pptx/other)
- Uses existing `/document` API endpoints for file listing

**Center panel:** Reuse `<OnlyOfficeEditor>` component.

**Right panel:** Reuse `<MessageList>` + `<Composer>` chat components.

### 4. Routing Changes

**File:** `packages/app/src/app/types.ts`

Add `"document-agent"` to `View` type:
```ts
export type View = "onboarding" | "dashboard" | "session" | "proto" | "document-writer" | "document-agent";
```

**File:** `packages/app/src/app/app.tsx`

- Add URL pattern `/document-agent/:id` → `"document-agent"` in `currentView` memo
- Add `goToDocumentAgent(sessionId)` navigation helper
- Add `<Match when={currentView() === "document-agent"}>` rendering branch
- Add document-agent props (similar to document-writer props)

### 5. Files Changed vs Created

| File | Action |
|------|--------|
| `packages/app/src/app/pages/dashboard.tsx` | MODIFY — comment out nav items, default tab |
| `packages/app/src/app/pages/session.tsx` | MODIFY — comment out nav items |
| `packages/app/src/app/pages/agents.tsx` | MODIFY — replace agent list |
| `packages/app/src/app/pages/document-agent.tsx` | NEW — document agent page |
| `packages/app/src/app/types.ts` | MODIFY — add View type |
| `packages/app/src/app/app.tsx` | MODIFY — add route, navigation, rendering |

### 6. What Is NOT Changed

- Left sidebar conversation history — preserved as-is
- document-writer page — untouched (used by Bid Writer)
- Session page — untouched (used by General Assistant)
- OnlyOffice integration — reused, not modified
- Server-side code — no changes
- All hidden items use JSX comments, not code deletion
