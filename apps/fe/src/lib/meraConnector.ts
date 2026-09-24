import { createConnector } from "wagmi";
import { createWalletClient, getAddress, http, numberToHex, type Address, type Chain } from "viem";
import { toAccount } from "viem/accounts";
import { passkeyEnabled, readPasskeyRecord, withPasskeyAccount } from "./passkey";

export const MERA_CONNECTOR_ID = "deltamon-mera";

function signer(address: Address) {
  return toAccount({
    address,
    async sign({ hash }) {
      return withPasskeyAccount(address, (account) => account.sign!({ hash }));
    },
    async signMessage({ message }) {
      return withPasskeyAccount(address, (account) => account.signMessage({ message }));
    },
    async signTransaction(transaction, options) {
      return withPasskeyAccount(address, (account) => account.signTransaction(transaction, options));
    },
    async signTypedData(typedData) {
      return withPasskeyAccount(address, (account) => account.signTypedData(typedData));
    },
    async signAuthorization(authorization) {
      return withPasskeyAccount(address, (account) => account.signAuthorization!(authorization));
    },
  });
}

export const meraConnector = createConnector((config) => {
  let currentChainId = 143;
  let connectedAddress: Address | undefined;
  const chainFor = (chainId: number): Chain => {
    const chain = config.chains.find((item) => item.id === chainId);
    if (!chain) throw new Error(`Chain ${chainId} is not supported by DeltaMon.`);
    return chain;
  };
  const address = (): Address => {
    if (!passkeyEnabled()) throw new Error("Passkey wallets are unavailable on this site.");
    const record = readPasskeyRecord();
    if (!record) throw new Error("Choose your passkey wallet first.");
    if (connectedAddress && record.address.toLowerCase() !== connectedAddress.toLowerCase()) {
      throw new Error("The selected passkey wallet changed. Reconnect before signing.");
    }
    return getAddress(record.address);
  };

  return {
    id: MERA_CONNECTOR_ID,
    name: "DeltaMon passkey",
    type: "deltamon-mera",
    async connect<withCapabilities extends boolean = false>({ chainId, withCapabilities }: { chainId?: number; isReconnecting?: boolean; withCapabilities?: withCapabilities | boolean } = {}) {
      if (chainId) currentChainId = chainFor(chainId).id;
      const account = address();
      connectedAddress = account;
      return { accounts: (withCapabilities ? [{ address: account, capabilities: {} }] : [account]) as never, chainId: currentChainId };
    },
    async disconnect() { connectedAddress = undefined; },
    async getAccounts() {
      return [address()];
    },
    async getChainId() {
      return currentChainId;
    },
    async getClient({ chainId } = {}) {
      const chain = chainFor(chainId ?? currentChainId);
      return createWalletClient({
        account: signer(address()),
        chain,
        transport: http(chain.rpcUrls.default.http[0]),
      });
    },
    async getProvider() {
      return {
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          if (method === "eth_accounts" || method === "eth_requestAccounts") return [address()];
          if (method === "eth_chainId") return numberToHex(currentChainId);
          if (method === "wallet_switchEthereumChain") {
            const requested = (params?.[0] as { chainId?: string } | undefined)?.chainId;
            if (!requested) throw new Error("A chain ID is required.");
            currentChainId = chainFor(Number(requested)).id;
            config.emitter.emit("change", { chainId: currentChainId });
            return null;
          }
          throw new Error(`The passkey provider does not expose ${method}; use DeltaMon's wallet actions.`);
        },
      };
    },
    async isAuthorized() {
      return passkeyEnabled() && Boolean(readPasskeyRecord());
    },
    async switchChain({ chainId }) {
      const chain = chainFor(chainId);
      currentChainId = chain.id;
      config.emitter.emit("change", { chainId });
      return chain;
    },
    onAccountsChanged(accounts: string[]) {
      if (accounts.length) config.emitter.emit("change", { accounts: accounts.map((item) => getAddress(item)) });
      else config.emitter.emit("disconnect");
    },
    onChainChanged(chainId: string) {
      currentChainId = Number(chainId);
      config.emitter.emit("change", { chainId: currentChainId });
    },
    onDisconnect() {
      config.emitter.emit("disconnect");
    },
  };
});
