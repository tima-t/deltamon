import { HACKATHON } from "@deltamon/shared";

export function SiteFooter() {
  return (
    <footer className="border-line mt-auto border-t">
      <div className="text-muted mx-auto flex w-full max-w-6xl flex-col gap-3 px-5 py-8 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <span>
          Built for{" "}
          <a href={HACKATHON.url} className="text-ink underline-offset-2 hover:underline">
            {HACKATHON.name}
          </a>{" "}
          · {HACKATHON.track}
        </span>
        <div className="flex gap-5">
          <a href="https://github.com/tima-t/deltamon" className="hover:text-ink">
            Source
          </a>
          <a href="https://monadvision.com" className="hover:text-ink">
            Explorer
          </a>
          <a href="https://docs.monad.xyz" className="hover:text-ink">
            Monad docs
          </a>
        </div>
      </div>
    </footer>
  );
}
