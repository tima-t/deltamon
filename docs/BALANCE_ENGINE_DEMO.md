# Balance Engine hackathon demo sequence

Target length: 2–3 minutes. Use a deployed vault and a funded test wallet. The manager bot must publish `shortNotional` at `PERP_BOOK_URL` for a live neutrality demonstration. If that feed is not ready, show the clearly labeled illustrative example and say so; never present it as a live short.

1. **The promise (0:00–0:20).** Open the homepage. Point to MON held, manager-reported short notional, and net exposure on the dial. Explain that collateral is not the same as short size.
2. **The deposit (0:20–1:05).** Choose Monad USDC or a supported source chain. Enter an amount, show estimated sdMON shares and any cross-chain fee, then approve and deposit. Follow only real wallet and settlement states.
3. **The vault book (1:05–1:35).** Show actual MON allocation, idle USDC, manager capital and book equity. Open “How can a 60/40 funding mix be delta neutral?” to explain the illustrative $60 long / $60 short / $40 collateral example.
4. **The hedge (1:35–2:05).** Refresh the manager report. Show its age and the measured net exposure. If a real position drifts beyond ±2%, show the warning and a later fresh report after the manager adjusts the short. Do not animate an adjustment that did not happen.
5. **The exit (2:05–2:45).** Show the connected wallet's shares and instant redeem capacity. Redeem a small amount if idle USDC covers it; otherwise queue a request and show its deadline, settlement and cancellation controls.

Before recording: verify the API shows `source: onchain`, the short report is fresh, all transactions link to MonadVision, and the wallet holds enough USDC and gas. Record dark mode first, then capture a brief light-mode view for the project profile.
