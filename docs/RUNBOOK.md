# Attnn. runbook: when something goes wrong

Read this when a health-check email arrives, a user reports missing money, or a service is down. Act in order. If unsure, **pause new bids first**: it never traps anyone's money.

## The pause switch

Stops all new bids, agent runs and counter re-bids within 15 seconds. Replies, declines and refunds keep working, so no USDC is ever trapped by a pause.

In the Supabase SQL Editor (mainnet project):

```sql
-- Pause
insert into app_settings (key, value) values ('bids_paused', 'true')
on conflict (key) do update set value = 'true', updated_at = now();

-- Resume
update app_settings set value = 'false', updated_at = now() where key = 'bids_paused';
```

Users see "New bids are paused for maintenance". The hourly check reminds you while it's on.

## Health-check alerts

The **Money Health Check** job (Inngest) runs every hour, plus a full escrow check daily at 06:40 UTC. It only reads; it never changes anything. It emails `ALERT_EMAIL` when something needs a person. To run it on demand, send the event `attnn/admin.health-check` with `{ "full": true }` from the Inngest dashboard; a passing run emails "Health check passed".

| Alert | What it means | What to do |
| --- | --- | --- |
| **ESCROW SHORTFALL** | The contract holds less USDC than its pending bids are owed. Should be impossible. | 1. Pause new bids. 2. Don't touch the contract. 3. Compare `getTotalLocked()` and the bids on the explorer. 4. Contact the contract reviewer/auditor and Circle. 5. Tell affected users plainly. |
| Pending on-chain with no open row | USDC is in escrow but no database row tracks it, so the creator can't reply and auto-refund won't claim it. | Send `attnn/admin.reconcile-bids` with `{}` (dry run). Check the report, then send `{ "apply": true }`. Re-run the health check. |
| Open row with no bid on-chain | The database shows a bid that was never escrowed. | Same: reconcile dry run, then apply (it marks the row failed, "no USDC moved"). |
| Still "placing" after an hour | A placement job ran out of time and the sweep couldn't finish it. | Look the bid up in Circle's console by its `bid_tx_hash`, or by refId `place:<bidId>`. COMPLETE → the sweep will finish it; check the sweep runs in Inngest. FAILED → it fails on the next sweep, no USDC moved. |
| Settlement in flight over an hour | An accept, decline or refund was sent but never confirmed. | Find the Circle transaction (`settlement_tx_hash`). COMPLETE → check the Inngest `confirm-settlement` and sweep runs. STUCK → accelerate or cancel it in the Circle console. |
| Failed settlement waiting for a retry | Circle or the chain refused an accept, decline or refund. The bid is still open and its USDC is still in escrow. | Read `fail_reason`. Usually the wallet is out of gas USDC; add $1 to that wallet. The creator can retry; auto-refund retries refunds hourly. |

## A user says their money is missing

1. Get their bid (dashboard or `select * from bids where id = '…'`).
2. Open its `on_chain_tx_hash` on the explorer. No hash and status `failed` → no USDC moved; the reason is in `fail_reason`.
3. Status `pending` → the USDC is in escrow. The creator can accept within 3 days and decline at any time; after 3 days auto-refund claims it (hourly, at :17).
4. `refunded` or `rejected` → the USDC went back to the wallet that placed the bid. For agent bids that's the **agent wallet** (Agent tab), not the main wallet.
5. `accepted` → paid to the creator. The settlement hash is the proof.

## A key may have leaked

| What leaked | Do immediately |
| --- | --- |
| Circle API key or entity secret | Pause new bids. Rotate the key in the Circle console (Keys). Update it in Vercel and redeploy. Review Circle's API logs for calls you don't recognise. |
| Supabase database password or service-role key | Reset it in Supabase settings. Update Vercel. Review the database for unexpected changes. |
| Vercel, GitHub or Inngest account | Revoke sessions, change the password, check two-step login is on, review recent deploys and environment changes. |
| The contract deployer key | Nothing to rotate in the contracts: they have no owner powers. Stop using that key. |

Users' wallet keys never leave Circle; Attnn only holds the API key and entity secret that operate them. Protect those two above everything else.

## A service is down

| Down | Effect | What to do |
| --- | --- | --- |
| Circle | No new bids, settlements or wallets. Escrowed USDC is safe. | Pause new bids if it lasts more than a few minutes. Retries and the sweep finish everything once it's back. |
| Arc RPC | Balance and escrow reads fail. New bids and settlements fail with a reason; no USDC moves. | Set `ARC_RPC_URL` to another Arc RPC provider in Vercel and redeploy. |
| Inngest | Placements and settlements queue up; nothing confirms. | Nothing is lost. When it returns, the sweep (every 10 min) catches up. |
| Supabase | The app is down. | Wait. On-chain funds are unaffected. Run the full health check afterwards. |
| AI (AISA) | Agents stop placing bids ("AI unavailable"); the creator agent falls back to fixed rules. | Nothing to do. |

## Known edge case: a blacklisted USDC address

Circle can blacklist an address. If a **bidder's** address is blacklisted while their bid is in escrow, decline and refund for that bid revert, so the USDC stays in the escrow; accepting still works. The health check won't flag it (the escrow still holds what it owes). Handle case by case with Circle support.

## Contacts

| For | Who |
| --- | --- |
| Circle (wallets, Gateway, blacklisting) | Circle support, via the Console's Need Help, and the accelerator contact (James) |
| Arc network | Arc team / Discord |
| Contract review | (fill in when the audit is booked) |
| On call | (fill in: who gets the alert email, and who backs them up) |
