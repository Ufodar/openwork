export type ScrollContainerLike = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

export type PreserveScrollOnToggleOptions = {
  threshold?: number;
  schedule?: (cb: () => void) => void;
};

const DEFAULT_NEAR_BOTTOM_THRESHOLD = 96;

const scheduleAfterNextPaint = (cb: () => void) => {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    cb();
    return;
  }
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(cb);
  });
};

export function preserveScrollPositionOnToggle(
  container: ScrollContainerLike | null | undefined,
  update: () => void,
  options?: PreserveScrollOnToggleOptions,
) {
  if (!container) {
    update();
    return;
  }

  const threshold = Math.max(0, options?.threshold ?? DEFAULT_NEAR_BOTTOM_THRESHOLD);
  const previousScrollTop = container.scrollTop;
  const distanceFromBottom =
    container.scrollHeight - container.clientHeight - container.scrollTop;

  update();

  if (distanceFromBottom <= threshold) return;

  const schedule = options?.schedule ?? scheduleAfterNextPaint;
  schedule(() => {
    container.scrollTop = previousScrollTop;
  });
}
