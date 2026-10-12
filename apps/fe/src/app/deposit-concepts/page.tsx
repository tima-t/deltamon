import { notFound } from "next/navigation";
import DepositConcepts from "./DepositConcepts";

export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <DepositConcepts />;
}
