import { Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup } from "solid-js";

declare global {
  interface Window {
    DocsAPI?: {
      DocEditor?: new (containerId: string, config: Record<string, unknown>) => {
        destroyEditor?: () => void;
      };
    };
  }
}

interface OnlyOfficeEditorProps {
  documentServerUrl: string;
  config: Record<string, unknown>;
  class?: string;
  id?: string;
}

export default function OnlyOfficeEditor(props: OnlyOfficeEditorProps) {
  let containerRef: HTMLDivElement | undefined;
  let docEditor: { destroyEditor?: () => void } | null = null;

  const autoId = createUniqueId();
  const containerId = createMemo(() => props.id ?? `onlyoffice-${autoId}`);

  const documentServerUrl = createMemo(() => props.documentServerUrl.trim().replace(/\/+$/, ""));
  const scriptUrl = createMemo(() => `${documentServerUrl()}/web-apps/apps/api/documents/api.js`);

  const [scriptStatus, setScriptStatus] = createSignal<"idle" | "loading" | "ready" | "error">("idle");
  const [scriptError, setScriptError] = createSignal<string | null>(null);
  const [editorError, setEditorError] = createSignal<string | null>(null);

  createEffect(() => {
    const url = scriptUrl();
    setScriptError(null);
    setScriptStatus("loading");

    if (window.DocsAPI?.DocEditor) {
      setScriptStatus("ready");
      return;
    }

    const existing = Array.from(document.querySelectorAll("script")).find((node) => {
      const src = (node as HTMLScriptElement).src || node.getAttribute("src") || "";
      return src === url;
    }) as HTMLScriptElement | undefined;

    let canceled = false;
    const onLoad = () => {
      if (canceled) return;
      setScriptStatus(window.DocsAPI?.DocEditor ? "ready" : "error");
      if (!window.DocsAPI?.DocEditor) {
        setScriptError("OnlyOffice script loaded but DocsAPI is missing.");
      }
    };
    const onError = () => {
      if (canceled) return;
      setScriptStatus("error");
      setScriptError("Failed to load OnlyOffice DocsAPI script.");
    };

    if (existing) {
      existing.addEventListener("load", onLoad);
      existing.addEventListener("error", onError);
      onCleanup(() => {
        canceled = true;
        existing.removeEventListener("load", onLoad);
        existing.removeEventListener("error", onError);
      });
      return;
    }

    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
    document.body.appendChild(script);

    onCleanup(() => {
      canceled = true;
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    });
  });

  createEffect(() => {
    const status = scriptStatus();
    const config = props.config;
    const id = containerId();

    setEditorError(null);
    if (status !== "ready") return;
    if (!containerRef) return;
    if (!config) return;

    if (docEditor?.destroyEditor) {
      docEditor.destroyEditor();
      docEditor = null;
    }

    try {
      const api = window.DocsAPI;
      if (!api?.DocEditor) {
        throw new Error("OnlyOffice DocsAPI is not available.");
      }
      docEditor = new api.DocEditor(id, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to initialize OnlyOffice editor.";
      setEditorError(message);
    }

    onCleanup(() => {
      if (docEditor?.destroyEditor) {
        docEditor.destroyEditor();
      }
      docEditor = null;
    });
  });

  const errorMessage = createMemo(() => scriptError() ?? editorError());

  return (
    <div class={`relative w-full h-full ${props.class ?? ""}`}>
      <div id={containerId()} ref={containerRef} class="absolute inset-0" />
      <Show when={errorMessage()}>
        {(message) => (
          <div class="absolute inset-0 flex items-center justify-center bg-dls-surface/80 text-red-11 text-xs px-4 text-center">
            {message()}
          </div>
        )}
      </Show>
    </div>
  );
}
