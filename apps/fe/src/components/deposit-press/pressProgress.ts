/** Paper length represents confirmed milestones, never elapsed waiting time. */
export const PRESS_FEED_DURATION = 0.95;
export function paperLength(confirmed: number) {
  return 0.65 + Math.max(0, Math.min(4, Math.floor(confirmed))) * 0.6;
}
export function interpolatePaper(from: number, to: number, elapsed: number) {
  const progress = Math.max(0, Math.min(1, elapsed / PRESS_FEED_DURATION));
  const smooth = progress * progress * (3 - 2 * progress);
  return from + (to - from) * smooth;
}
