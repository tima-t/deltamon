import { getDeployment } from "@deltamon/shared";

export function SiteFooter() {
  const vault = process.env.NEXT_PUBLIC_VAULT_ADDRESS || getDeployment(143)?.vault;

  return (
    <footer className="border-line mt-auto border-t">
      <div className="text-muted mx-auto flex w-full max-w-7xl flex-col gap-3 px-5 py-8 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <span>DeltaMon · MON strategy on Monad</span>
        <div className="flex gap-5">
          <a href="https://github.com/tima-t/deltamon" className="hover:text-ink">
            Source code
          </a>
          {vault ? (
            <a href={`https://monadvision.com/address/${vault}`} className="hover:text-ink">
              Vault contract
            </a>
          ) : null}
          <a href="https://docs.monad.xyz" className="hover:text-ink">
            Monad docs
          </a>
        </div>
      </div>
    </footer>
  );
}
