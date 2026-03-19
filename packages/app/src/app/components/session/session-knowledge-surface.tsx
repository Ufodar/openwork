import { Show, createEffect, createMemo, createSignal, on } from "solid-js";

import {
  OpenworkServerError,
  type OpenworkKnowledgeItem,
  type OpenworkKnowledgeScope,
  type OpenworkServerClient,
} from "../../lib/openwork-server";
import { reduceKnowledgeSelection, sameKnowledgeSelection } from "../../lib/knowledge-selection";
import KnowledgePickerModal from "./knowledge-picker-modal";
import KnowledgeStrip from "./knowledge-strip";

export type SessionKnowledgeSurfaceProps = {
  client: OpenworkServerClient | null;
  workspaceId: string | null | undefined;
  sessionId: string | null | undefined;
  editingLocked?: boolean;
  tr: (key: string) => string;
  onToast?: (message: string) => void;
};

type SessionKnowledgeContext = {
  client: OpenworkServerClient;
  workspaceId: string;
  sessionId: string;
};

function resolveSessionKnowledgeContext(
  client: OpenworkServerClient | null,
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
): SessionKnowledgeContext | null {
  const normalizedWorkspaceId = workspaceId?.trim() ?? "";
  const normalizedSessionId = sessionId?.trim() ?? "";
  if (!client || !normalizedWorkspaceId || !normalizedSessionId) return null;
  return {
    client,
    workspaceId: normalizedWorkspaceId,
    sessionId: normalizedSessionId,
  };
}

export default function SessionKnowledgeSurface(props: SessionKnowledgeSurfaceProps) {
  let knowledgeAttachmentRequestSeq = 0;
  let knowledgeMineRequestSeq = 0;
  let knowledgeOthersRequestSeq = 0;

  const [knowledgePickerOpen, setKnowledgePickerOpen] = createSignal(false);
  const [knowledgePickerScope, setKnowledgePickerScope] = createSignal<OpenworkKnowledgeScope>("mine");
  const [attachedKnowledgeIds, setAttachedKnowledgeIds] = createSignal<string[]>([]);
  const [attachedKnowledgeItems, setAttachedKnowledgeItems] = createSignal<OpenworkKnowledgeItem[]>([]);
  const [knowledgeAttachmentsLoading, setKnowledgeAttachmentsLoading] = createSignal(false);
  const [knowledgeAttachmentsError, setKnowledgeAttachmentsError] = createSignal<string | null>(null);
  const [knowledgeMineItems, setKnowledgeMineItems] = createSignal<OpenworkKnowledgeItem[]>([]);
  const [knowledgeOthersItems, setKnowledgeOthersItems] = createSignal<OpenworkKnowledgeItem[]>([]);
  const [knowledgeMineLoaded, setKnowledgeMineLoaded] = createSignal(false);
  const [knowledgeOthersLoaded, setKnowledgeOthersLoaded] = createSignal(false);
  const [knowledgeMineLoading, setKnowledgeMineLoading] = createSignal(false);
  const [knowledgeOthersLoading, setKnowledgeOthersLoading] = createSignal(false);
  const [knowledgePickerError, setKnowledgePickerError] = createSignal<string | null>(null);
  const [knowledgeDraftIds, setKnowledgeDraftIds] = createSignal<string[]>([]);
  const [knowledgeSaveBusy, setKnowledgeSaveBusy] = createSignal(false);

  const sessionKnowledgeContext = createMemo(() =>
    resolveSessionKnowledgeContext(props.client, props.workspaceId, props.sessionId)
  );
  const knowledgeAvailable = createMemo(() => Boolean(sessionKnowledgeContext()));
  const knowledgeEditingLocked = createMemo(() => Boolean(props.editingLocked) || knowledgeSaveBusy());
  const allKnownKnowledgeItems = createMemo(() => {
    const map = new Map<string, OpenworkKnowledgeItem>();
    for (const item of [
      ...attachedKnowledgeItems(),
      ...knowledgeMineItems(),
      ...knowledgeOthersItems(),
    ]) {
      if (!item.knowledgeId || map.has(item.knowledgeId)) continue;
      map.set(item.knowledgeId, item);
    }
    return map;
  });
  const draftKnowledgeItems = createMemo(() =>
    knowledgeDraftIds()
      .map((knowledgeId) => allKnownKnowledgeItems().get(knowledgeId))
      .filter((item): item is OpenworkKnowledgeItem => Boolean(item))
  );
  const knowledgePickerLoading = createMemo(() =>
    knowledgePickerScope() === "others" ? knowledgeOthersLoading() : knowledgeMineLoading()
  );
  const knowledgeSelectionDirty = createMemo(() =>
    !sameKnowledgeSelection(attachedKnowledgeIds(), knowledgeDraftIds())
  );

  const notify = (message: string) => {
    props.onToast?.(message);
  };

  const resetKnowledgeCatalog = () => {
    setKnowledgeMineItems([]);
    setKnowledgeOthersItems([]);
    setKnowledgeMineLoaded(false);
    setKnowledgeOthersLoaded(false);
    setKnowledgeMineLoading(false);
    setKnowledgeOthersLoading(false);
    setKnowledgePickerError(null);
  };

  const describeKnowledgeError = (error: unknown, fallbackKey: string) => {
    if (error instanceof OpenworkServerError) return error.message;
    if (error instanceof Error) return error.message;
    return props.tr(fallbackKey);
  };

  const loadKnowledgeCatalog = async (scope: OpenworkKnowledgeScope) => {
    const ctx = sessionKnowledgeContext();
    if (!ctx) return;

    if (scope === "mine" && (knowledgeMineLoaded() || knowledgeMineLoading())) return;
    if (scope === "others" && (knowledgeOthersLoaded() || knowledgeOthersLoading())) return;

    if (scope === "mine") {
      const requestId = ++knowledgeMineRequestSeq;
      setKnowledgeMineLoading(true);
      setKnowledgePickerError(null);
      try {
        const result = await ctx.client.listKnowledge(ctx.workspaceId, "mine");
        if (requestId !== knowledgeMineRequestSeq) return;
        setKnowledgeMineItems(result.items);
        setKnowledgeMineLoaded(true);
      } catch (error) {
        if (requestId !== knowledgeMineRequestSeq) return;
        setKnowledgePickerError(describeKnowledgeError(error, "session.knowledge_picker_failed_load"));
      } finally {
        if (requestId === knowledgeMineRequestSeq) {
          setKnowledgeMineLoading(false);
        }
      }
      return;
    }

    const requestId = ++knowledgeOthersRequestSeq;
    setKnowledgeOthersLoading(true);
    setKnowledgePickerError(null);
    try {
      const result = await ctx.client.listKnowledge(ctx.workspaceId, "others");
      if (requestId !== knowledgeOthersRequestSeq) return;
      setKnowledgeOthersItems(result.items);
      setKnowledgeOthersLoaded(true);
    } catch (error) {
      if (requestId !== knowledgeOthersRequestSeq) return;
      setKnowledgePickerError(describeKnowledgeError(error, "session.knowledge_picker_failed_load"));
    } finally {
      if (requestId === knowledgeOthersRequestSeq) {
        setKnowledgeOthersLoading(false);
      }
    }
  };

  const openKnowledgePicker = () => {
    if (!knowledgeAvailable()) return;
    setKnowledgeDraftIds(attachedKnowledgeIds());
    setKnowledgePickerScope("mine");
    setKnowledgePickerError(null);
    setKnowledgePickerOpen(true);
    void loadKnowledgeCatalog("mine");
  };

  const closeKnowledgePicker = () => {
    setKnowledgePickerOpen(false);
    setKnowledgePickerError(null);
    setKnowledgeDraftIds(attachedKnowledgeIds());
  };

  const toggleKnowledgeDraft = (knowledgeId: string, checked: boolean) => {
    setKnowledgeDraftIds((current) => reduceKnowledgeSelection(current, [{ id: knowledgeId, checked }]));
  };

  const saveKnowledgeSelection = async () => {
    const ctx = sessionKnowledgeContext();
    if (!ctx || knowledgeSaveBusy()) return;
    setKnowledgeSaveBusy(true);
    setKnowledgePickerError(null);
    try {
      const result = await ctx.client.setSessionKnowledge(ctx.workspaceId, ctx.sessionId, knowledgeDraftIds());
      setAttachedKnowledgeIds(result.knowledgeIds);
      setAttachedKnowledgeItems(result.items);
      setKnowledgeDraftIds(result.knowledgeIds);
      setKnowledgePickerOpen(false);
      notify(props.tr("session.knowledge_picker_saved"));
    } catch (error) {
      const message = describeKnowledgeError(error, "session.knowledge_picker_failed_save");
      setKnowledgePickerError(message);
      notify(message);
    } finally {
      setKnowledgeSaveBusy(false);
    }
  };

  createEffect(
    on(sessionKnowledgeContext, (ctx) => {
      const requestId = ++knowledgeAttachmentRequestSeq;
      if (!ctx) {
        setAttachedKnowledgeIds([]);
        setAttachedKnowledgeItems([]);
        setKnowledgeAttachmentsLoading(false);
        setKnowledgeAttachmentsError(null);
        closeKnowledgePicker();
        return;
      }

      setKnowledgeAttachmentsLoading(true);
      setKnowledgeAttachmentsError(null);
      void ctx.client
        .getSessionKnowledge(ctx.workspaceId, ctx.sessionId)
        .then((result) => {
          if (requestId !== knowledgeAttachmentRequestSeq) return;
          setAttachedKnowledgeIds(result.knowledgeIds);
          setAttachedKnowledgeItems(result.items);
          if (!knowledgePickerOpen()) {
            setKnowledgeDraftIds(result.knowledgeIds);
          }
        })
        .catch((error) => {
          if (requestId !== knowledgeAttachmentRequestSeq) return;
          setAttachedKnowledgeIds([]);
          setAttachedKnowledgeItems([]);
          setKnowledgeAttachmentsError(describeKnowledgeError(error, "session.knowledge_load_failed"));
        })
        .finally(() => {
          if (requestId === knowledgeAttachmentRequestSeq) {
            setKnowledgeAttachmentsLoading(false);
          }
        });
    })
  );

  createEffect(
    on(
      () => props.workspaceId,
      () => {
        resetKnowledgeCatalog();
      }
    )
  );

  createEffect(
    on(
      () => props.sessionId,
      () => {
        setKnowledgePickerOpen(false);
        setKnowledgePickerError(null);
      }
    )
  );

  createEffect(
    on(
      () => [knowledgePickerOpen(), knowledgePickerScope()] as const,
      ([open, scope]) => {
        if (!open) return;
        void loadKnowledgeCatalog(scope);
      }
    )
  );

  return (
    <>
      <Show when={knowledgeAvailable()}>
        <KnowledgeStrip
          attachedItems={attachedKnowledgeItems()}
          loading={knowledgeAttachmentsLoading()}
          error={knowledgeAttachmentsError()}
          editingLocked={knowledgeEditingLocked()}
          onManage={openKnowledgePicker}
          tr={props.tr}
        />
      </Show>

      <KnowledgePickerModal
        open={knowledgePickerOpen()}
        scope={knowledgePickerScope()}
        selectedIds={knowledgeDraftIds()}
        selectedItems={draftKnowledgeItems()}
        mineItems={knowledgeMineItems()}
        othersItems={knowledgeOthersItems()}
        loading={knowledgePickerLoading()}
        error={knowledgePickerError()}
        saving={knowledgeSaveBusy()}
        saveDisabled={knowledgeSaveBusy() || !knowledgeSelectionDirty() || knowledgeEditingLocked()}
        editingLocked={knowledgeEditingLocked()}
        onScopeChange={setKnowledgePickerScope}
        onToggle={toggleKnowledgeDraft}
        onClose={closeKnowledgePicker}
        onSave={saveKnowledgeSelection}
        tr={props.tr}
      />
    </>
  );
}
