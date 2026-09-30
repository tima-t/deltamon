import { notFound } from "next/navigation";
import { DepositFlowLab } from "@/components/DepositFlowLab";

export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <DepositFlowLab />;
}
