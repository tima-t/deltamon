export const DEPOSIT_CONFIRMED_EVENT = "deltamon:deposit-confirmed";

export function showReturnRouteAfterDeposit() {
  window.dispatchEvent(new Event(DEPOSIT_CONFIRMED_EVENT));

  const returnRoute = document.getElementById("position");
  if (!returnRoute) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  returnRoute.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  document.getElementById("return-route-title")?.focus({ preventScroll: true });
}
