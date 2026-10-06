export const DEPOSIT_CONFIRMED_EVENT = "deltamon:deposit-confirmed";

export function showReturnRouteAfterDeposit({ reveal = true }: { reveal?: boolean } = {}) {
  window.dispatchEvent(new Event(DEPOSIT_CONFIRMED_EVENT));
  if (reveal) revealReturnRouteAfterDeposit();
}

export function revealReturnRouteAfterDeposit() {
  const returnRoute = document.getElementById("position");
  if (!returnRoute) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  returnRoute.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  document.getElementById("return-route-title")?.focus({ preventScroll: true });
}
