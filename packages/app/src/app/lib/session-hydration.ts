export const isSessionHydrating = (options: {
  sessionId: string | null | undefined;
  routeSessionHydratingId: string | null | undefined;
  busy: boolean;
  busyLabel: string | null | undefined;
}) => {
  const sessionId = options.sessionId?.trim();
  if (!sessionId) return false;
  if (options.routeSessionHydratingId?.trim() === sessionId) return true;
  return options.busy && options.busyLabel === "status.loading_session";
};
