export function isTodoCompletedStatus(status: unknown) {
  const text = typeof status === "string" ? status.trim().toLowerCase() : "";
  return text === "completed" || text === "done";
}
