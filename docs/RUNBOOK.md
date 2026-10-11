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

## The contract pause (emergency brake on Arc)

The app switch above only stops **Attnn.'s own server**. Anyone can still call the escrow directly, and a compromised server could ignore the switch. The escrow contract (v2) has its own pause, held by the **escrow admin wallet** (a hardware wallet or multisig you control, never a key on the server). Use it when the contract itself may be unsafe to put new money into: a bug in bid placement, a suspicious transaction pattern, a compromised Attnn server.

- **What it does:** `placeBid` reverts for everyone, at once. Accept, decline and refund keep working, so nobody's USDC is trapped. The admin can **never** move, freeze or redirect escrowed USDC.
- **How:** `node --env-file=.env.local scripts/escrow-admin.mjs pause` prints the exact transaction (to, data). Send it **from the admin wallet**: the explorer's "Write contract" tab (`pause()`), or your multisig's transaction builder with that data. The wallet needs a few cents of USDC for gas. Nothing in this repo ever holds the admin key.
- **Then:** the app shows "New bids are paused" within 15 s and stops agent runs; the hourly health check emails while it's paused. Also flip the app switch above, so the paused state is visible in the database.
- **Resume:** `scripts/escrow-admin.mjs unpause`, same way. Only after the cause is fixed. If the fix needs new contract code, deploy a new escrow, set it as `ATTN_ESCROW_CONTRACT`, add the old one to `ATTN_LEGACY_ESCROW_CONTRACTS` so its open bids still settle, and leave the old one paused.
- `scripts/escrow-admin.mjs status` shows the admin, any open handover and whether bids are paused.

## Health-check alerts

The **Money Health Check** job (Inngest) runs every hour, plus a full escrow check daily at 06:40 UTC. It only reads; it never changes anything. It emails `ALERT_EMAIL` when something needs a person. To run it on demand, send the event `attnn/admin.health-check` with `{ "full": true }` from the Inngest dashboard; a passing run emails "Health check passed".

| Alert | What it means | What to do |
| --- | --- | --- |
| **ESCROW SHORTFALL** | The contract holds less USDC than its pending bids are owed. Should be impossible. | 1. Pause new bids. 2. Don't touch the contract. 3. Compare `getTotalLocked()` and the bids on the explorer. 4. Contact the contract reviewer/auditor and Circle. 5. Tell affected users plainly. |
| Pending on-chain with no open row | USDC is in escrow but no database row tracks it, so the creator can't reply and auto-refund won't claim it. | Send `attnn/admin.reconcile-bids` with `{}` (dry run). Check the report, then send `{ "apply": true }`. Re-run the health check. |
| Open row with no bid on-chain | The database shows a bid that was never escrowed. | Same: reconcile dry run, then apply (it marks the row failed, "no USDC moved"). |
| Still "placing" after an hour | A placement job ran out of time and the sweep couldn't finish it. | Look the bid up in Circle's console by its `bid_tx_hash`, or by refId `place:<bidId>`. COMPLETE → the sweep will finish it; check the sweep runs in Inngest. FAILED → it fails on the next sweep, no USDC moved. |
| Settlement in flight over an hour | An accept, decline or refund was sent but never confirmed. | Find the Circle transaction (`settlement_tx_hash`). COMPLETE → check the Inngest `confirm-settlement` and sweep runs. STUCK → accelerate or cancel it in the Circle console. |
| The escrow contract is PAUSED on-chain | New bids are refused by the contract. | If you paused it, nothing to do until you unpause. **If you didn't**, the admin wallet may be compromised: see "A key may have leaked". |
| The escrow's owner is not ATTN_ESCROW_ADMIN | The admin role moved to another address. | If you handed it over, update `ATTN_ESCROW_ADMIN` in Vercel. If not, treat the admin wallet as compromised. The new owner can only pause new bids; escrowed USDC is safe. |
| An escrow ownership handover is open | Someone started handing the admin role to a new address. | If it wasn't you, cancel it now from the admin wallet: `scripts/escrow-admin.mjs cancel`. |
| Accepted bid(s) show no reply, or one that doesn't match the fingerprint | The creator was paid (on Arc) for a reply fingerprint that matches none of the replies saved for that bid, so the bidder sees no reply. Rare: the creator accepted outside Attnn., or saved replies were lost. | Look at the bid's `reply_candidates` and Circle transactions. If the text can't be recovered, tell the bidder and the creator plainly and ask the creator to resend the reply. The alert repeats daily for that bid; note the bid id as known. |
| Failed settlement waiting for a retry | Circle or the chain refused an accept, decline or refund. The bid is still open and its USDC is still in escrow. | Read `fail_reason`. Usually the wallet is out of gas USDC; add $1 to that wallet. The creator can retry; auto-refund retries refunds hourly. |

## Withdrawals (sending USDC out)

- Each account can send at most **$500 in any 24 hours** (`WITHDRAWAL_LIMIT_24H` in `lib/withdrawals.ts`; changing it is a code change). Sends between a user's own main and agent wallets don't count.
- The first send to a new address needs a 6-digit code emailed to the account. **No email service, no code**: if Resend is down, sends to new addresses wait; confirmed addresses keep working.
- Every send emails the account a notice. A user who gets one they didn't make: treat it as a stolen session. Sign them out everywhere (`delete from sessions where user_id = '…'`), and pause bids if more accounts are affected.
- A user who can't get the code: check Resend's logs for their address. Never read a code out to anyone, and never add an address to `withdrawal_addresses` by hand unless you've confirmed the user's identity outside the app.
- Their sends: `select created_at, to_address, amount_usdc, status from withdrawals where user_id = '…' order by created_at desc;` (`sending` = may have gone through and still counts; `failed` = Circle refused it, nothing moved).

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
| The contract deployer key | Nothing to rotate: the deployer has no powers in the contracts (the deploy script refuses to make it the escrow admin). Stop using that key. |
| The escrow admin wallet | Its only power is pausing new bids and handing the role over. If you still control it: hand the role to a fresh wallet (`scripts/escrow-admin.mjs transfer <new>`, then `accept` from the new one) and update `ATTN_ESCROW_ADMIN`. If an attacker has already taken the role, they can only pause new bids: escrowed USDC still pays out and refunds. Deploy a new escrow, point the app at it, and keep the old one as legacy so its bids settle. |

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
