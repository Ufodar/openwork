export type BusyStateSnapshot = {
  busy: boolean;
  busyLabel: string | null;
  busyStartedAt: number | null;
};

export const clearBusyState = (_current: BusyStateSnapshot): BusyStateSnapshot => ({
  busy: false,
  busyLabel: null,
  busyStartedAt: null,
});
