import { BaseError, ContractFunctionRevertedError } from "viem";

const firstLine = (text: string): string => text.split("\n")[0] ?? text;

/**
 * A revert in words. viem puts the decoded custom error on the second line of its message, so a
 * banner that keeps only the first line shows an empty reason. Pull the name and arguments out
 * instead: "NotAPerpManager(0x3efd…)" says far more than "the contract function reverted".
 */
export function describeRevert(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name) {
        const args = revert.data?.args ?? [];
        return args.length > 0 ? `${name}(${args.map(String).join(", ")})` : name;
      }
      if (revert.reason) return revert.reason;
    }
    return err.shortMessage || firstLine(err.message);
  }
  return err instanceof Error ? firstLine(err.message) : String(err);
}
