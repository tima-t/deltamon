export type DepositStep = "connect" | "source" | "amount" | "review" | "track";

export function DepositStepIndicator({
  current,
  includeSource = false,
}: {
  current: DepositStep;
  includeSource?: boolean;
}) {
  const steps: { id: DepositStep; label: string }[] = [
    { id: "connect", label: "Access" },
    ...(includeSource ? [{ id: "source" as const, label: "Source" }] : []),
    { id: "amount", label: "Amount" },
    { id: "review", label: "Review" },
    { id: "track", label: "Track" },
  ];
  const activeIndex = Math.max(
    0,
    steps.findIndex((step) => step.id === current),
  );

  return (
    <nav className="deposit-step-nav" aria-label="Deposit progress">
      <ol className="deposit-step-list">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className="deposit-step-item"
            data-state={index < activeIndex ? "past" : index === activeIndex ? "current" : "future"}
            aria-current={index === activeIndex ? "step" : undefined}
          >
            <span className="deposit-step-number">0{index + 1}</span>
            <span className="deposit-step-label">{step.label}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
