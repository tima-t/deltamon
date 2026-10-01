# Deploying to Railway

Two services from one repo, each with its own Dockerfile. Both build from the **repo root** as
context, because this is a pnpm workspace and both apps depend on `@deltamon/shared`.

| Service       | Dockerfile           | Port | Health check |
| ------------- | -------------------- | ---- | ------------ |
| `deltamon-be` | `apps/be/Dockerfile` | 4000 | `/health`    |
| `deltamon-fe` | `apps/fe/Dockerfile` | 3000 | `/`          |

There is no CI in this repo. Railway builds on push.

## Creating the services

For each service: **New → GitHub Repo → tima-t/deltamon**, then in _Settings_:

| Setting             | Backend                | Frontend               |
| ------------------- | ---------------------- | ---------------------- |
| Root Directory      | `/`                    | `/`                    |
| Builder             | **Dockerfile**         | **Dockerfile**         |
| Dockerfile Path     | `apps/be/Dockerfile`   | `apps/fe/Dockerfile`   |
| Config-as-code path | `apps/be/railway.json` | `apps/fe/railway.json` |

**Set the builder explicitly.** Railway auto-detects a builder, and for this repo it picks Railpack,
which runs `pnpm --filter @deltamon/be build` on its own. That skips `@deltamon/shared`, so the API
compiles against a package with no `dist` and fails with seventeen "Cannot find module
'@deltamon/shared'" errors. Choosing Dockerfile avoids the guess entirely.

Railway also looks for `railway.json` at the service's root directory, which is the repo root here,
so the per-service files have to be named under _Config-as-code_ or they are silently ignored.

If you would rather stay on Railpack, override the commands instead: build with `pnpm build:be` or
`pnpm build:fe`, which go through turbo and therefore build `@deltamon/shared` first, and start with
`pnpm start:be` or `pnpm start:fe`.

Deploy the backend first: the frontend bakes its URL in at build time.

### Watch paths

If you set watch paths so a service only rebuilds for its own changes, match the files that
actually exist. `apps/fe/**/*.ts` excludes every React component, because `.tsx` does not match
`*.ts`: the frontend then never rebuilds for a UI change and serves a stale image indefinitely.

| Service  | Watch paths                                          |
| -------- | ---------------------------------------------------- |
| Backend  | `apps/be/**`, `packages/shared/**`, `pnpm-lock.yaml` |
| Frontend | `apps/fe/**`, `packages/shared/**`, `pnpm-lock.yaml` |

Both apps compile `@deltamon/shared`, so a change there has to rebuild both.

## Backend variables

Railway injects `PORT`. The server already defaults `HOST` to `0.0.0.0`, so it binds correctly
without help.

| Variable                                 | Required         | Notes                                                       |
| ---------------------------------------- | ---------------- | ----------------------------------------------------------- |
| `CHAIN_ID`                               | yes              | `143` for Monad mainnet                                     |
| `RPC_URL`                                | yes              | `https://rpc.monad.xyz`                                     |
| `VAULT_ADDRESS`                          | yes              | the deployed vault                                          |
| `CORS_ORIGIN`                            | yes              | the frontend's public URL, exactly, no trailing slash       |
| `MONGO_CONNECTION_STRING`                | for automation   | add a Railway MongoDB and reference its URL                 |
| `MONGO_DB_NAME`                          | no               | defaults to `deltamon`                                      |
| `ADMIN_PRIVATE_KEY`                      | for automation   | signs the vault's swaps, staking and manager funding        |
| `PERP_MANAGER_PRIVATE_KEY`               | for automation   | signs the AUSD approve and the Perpl deposit                |
| `PERP_MANAGER_ADDRESS`                   | for automation   | must already be a manager on the vault                      |
| `PERPL_MANAGERS`                         | for the perp tab | comma separated public addresses allowed to sign in         |
| `PERPL_API_KEY` / `PERPL_API_KEY_SECRET` | for the perp tab | from `pnpm --filter @deltamon/be perpl:enroll`              |
| `KEEPER_ENABLED` / `KEEPER_PRIVATE_KEY`  | no               | the perp mark and reward keeper                             |
| `VALIDATOR_IDS`                          | for staking      | comma separated, the first is what the pipeline stakes with |

**Run one replica.** The automation pins transaction nonces and holds a single Perpl socket; a
second instance would compete for both. Trigger keys stop it duplicating a pipeline run, but the
nonce pinning assumes one writer.

## Frontend variables

`NEXT_PUBLIC_*` values are compiled into the browser bundle, so they are **build arguments**, not
runtime variables. Set them under _Settings → Build → Build Arguments_, and note that changing one
requires a redeploy, not a restart.

| Build argument                         | Notes                                       |
| -------------------------------------- | ------------------------------------------- |
| `NEXT_PUBLIC_API_URL`                  | the backend's public URL, no trailing slash |
| `NEXT_PUBLIC_VAULT_ADDRESS`            | the deployed vault                          |
| `NEXT_PUBLIC_DEFAULT_CHAIN_ID`         | defaults to `143`                           |
| `NEXT_PUBLIC_SITE_URL`                 | the frontend's own public URL               |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | optional, for WalletConnect                 |

`AURORA_INTENTS_API_KEY` is read on the server at runtime, so that one is a normal variable.

The two URLs have to agree: `CORS_ORIGIN` on the backend must be exactly the frontend's origin, and
`NEXT_PUBLIC_API_URL` exactly the backend's. A mismatch shows up in the browser as the console
reporting that the backend is not answering, because a blocked preflight and an unreachable host
look identical to `fetch`.

## Building locally

```bash
docker build -f apps/be/Dockerfile -t deltamon-be .
docker build -f apps/fe/Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=http://localhost:4000 \
  --build-arg NEXT_PUBLIC_VAULT_ADDRESS=0x… \
  -t deltamon-fe .

docker run --rm -p 4000:4000 --env-file apps/be/.env deltamon-be
docker run --rm -p 3000:3000 deltamon-fe
```

## What is in the images

The backend runs `pnpm deploy --prod`, which resolves one package's production tree rather than
copying the workspace's `node_modules`; that alone is the difference between 1.7 GB and 395 MB. The
frontend uses Next's `output: "standalone"`, which traces only the modules the server actually
loads, and comes out at 328 MB.

Both run as the `node` user and exec node directly with no shell wrapper, so `SIGTERM` reaches the
process. The backend closes the keeper, the automation runner, the Perpl socket and the Mongo
connection on the way out.

## After the first deploy

1. Open `/console`, paste the vault address if it is not already the default.
2. On the **Perp position** tab, sign in with an address listed in `PERPL_MANAGERS`.
3. On **Automations**, sign in as the vault admin and switch the pipeline on.
4. The manager wallet needs a little MON for gas, or the deposit step fails saying so.
