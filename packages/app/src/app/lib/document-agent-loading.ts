export function shouldShowDocumentAgentChatLoading(input: {
  sessionHydrating: boolean;
  messageCount: number;
  documentsReady: boolean;
}) {
  return input.sessionHydrating && input.messageCount === 0 && !input.documentsReady;
}
