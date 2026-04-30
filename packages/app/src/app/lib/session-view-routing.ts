import type { ResolvedSessionView } from "./session-preferences";

export type AppRouteView =
  | "onboarding"
  | "dashboard"
  | "session"
  | "proto"
  | "bid-workbench"
  | "document-agent"
  | "document-writer"
  | "login";

export const resolveAppRouteView = (pathname: string): AppRouteView => {
  const path = pathname.toLowerCase();
  if (path.startsWith("/login")) return "login";
  if (path.startsWith("/onboarding")) return "onboarding";
  if (path.startsWith("/session")) return "session";
  if (path.startsWith("/proto")) return "proto";
  if (path.startsWith("/bid-workbench")) return "bid-workbench";
  if (path.startsWith("/document-writer")) return "document-writer";
  if (path.startsWith("/document-agent")) return "document-agent";
  return "dashboard";
};

export const routeForSessionView = (view: ResolvedSessionView, sessionId: string): string => {
  const trimmed = sessionId.trim();
  if (!trimmed) return "/session";
  if (view === "document-agent") return `/document-agent/${trimmed}`;
  if (view === "document-writer") return `/document-writer/${trimmed}`;
  return `/session/${trimmed}`;
};

export const isDocumentSessionView = (view: string | null | undefined): view is "document-agent" | "document-writer" =>
  view === "document-agent" || view === "document-writer";
