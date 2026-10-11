/**
 * Everything that differs between escrow deployments lives here.
 *
 *   v2 (contracts/src/AttnnEscrow.sol, mainnet): bid messages and replies are stored
 *      on-chain only as fingerprints, fingerprint(salt, text) = keccak256(salt ‖ text),
 *      with a random 32-byte salt kept in the database next to the text. An owner
 *      wallet can pause NEW bids; settlements never pause.
 *   v1 (legacy testnet escrows): plain-text message and reply, no pause.
 *
 * The version is read from the deployed bytecode (does it have acceptBid(uint256,bytes32)?),
 * so a misconfigured env var can't make the app send the wrong arguments.
 */
import { bytesToHex, concat, keccak256, toFunctionSelector, toHex, zeroHash, type Hex } from "viem";
import { escrowAbi, escrowAbiV1, publicClient } from "./arc";

export type EscrowVersion = 1 | 2;

const V2_MARKER = toFunctionSelector("acceptBid(uint256,bytes32)").slice(2).toLowerCase();
const V1_MARKER = toFunctionSelector("acceptBid(uint256,string)").slice(2).toLowerCase();
const versions = new Map<string, EscrowVersion>();

/** Which escrow generation is deployed at this address. Cached; throws if there is no contract. */
export async function escrowVersion(escrow: string): Promise<EscrowVersion> {
  const key = escrow.toLowerCase();
  const known = versions.get(key);
  if (known) return known;
  const code = await publicClient.getCode({ address: key as Hex });
  if (!code || code === "0x") throw new Error(`No contract at escrow ${escrow}`);
  const lowered = code.toLowerCase();
  const v2 = lowered.includes(V2_MARKER);
  const v1 = lowered.includes(V1_MARKER);
  // Exactly one acceptBid: anything else isn't an escrow we know how to call.
  if (v1 === v2) throw new Error(`Escrow ${escrow}: unrecognised contract (acceptBid v1 ${v1}, v2 ${v2})`);
  const version: EscrowVersion = v2 ? 2 : 1;
  versions.set(key, version);
  return version;
}

export function escrowAbiFor(version: EscrowVersion) {
  return version === 2 ? escrowAbi : escrowAbiV1;
}

/** Forget cached versions and pause flags (tests). */
export function clearEscrowCache(): void {
  versions.clear();
  pausedCache.clear();
}

// ─── Fingerprints ────────────────────────────────────────────────────────────

/** A fresh random 32-byte salt (hex). One per message and one per reply. */
export function newSalt(): Hex {
  return bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

/** keccak256(salt ‖ UTF-8 text): the same as the contract's fingerprint(salt, text). */
export function fingerprint(salt: Hex, text: string): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(salt)) throw new Error("fingerprint: salt must be 32 bytes of hex");
  return keccak256(concat([salt, toHex(text)]));
}

/** True when this text and salt produce the fingerprint stored on-chain. */
export function matchesFingerprint(hash: string | null | undefined, salt: string | null | undefined, text: string | null | undefined): boolean {
  if (!hash || !salt || text == null || hash === zeroHash) return false;
  try {
    return fingerprint(salt as Hex, text).toLowerCase() === hash.toLowerCase();
  } catch {
    return false; // malformed salt
  }
}

// ─── Call arguments ──────────────────────────────────────────────────────────

/**
 * placeBid arguments for this escrow. v2 gets the message's fingerprint (zero when
 * there is no message). v1 gets an empty private message: the text stays in our
 * database instead of going on-chain in plain text.
 */
export function placeBidArgs(
  version: EscrowVersion,
  bid: { creator: string; amount: string; message: string | null; messageSalt: string | null },
): unknown[] {
  if (version === 1) return [bid.creator, bid.amount, "", true];
  const hash = bid.message && bid.messageSalt ? fingerprint(bid.messageSalt as Hex, bid.message) : zeroHash;
  return [bid.creator, bid.amount, hash];
}

/** acceptBid arguments: v2 sends only the reply's fingerprint, v1 the text. */
export function acceptBidArgs(version: EscrowVersion, onChainBidId: string, reply: string, replySalt: string): unknown[] {
  return version === 2 ? [onChainBidId, fingerprint(replySalt as Hex, reply)] : [onChainBidId, reply];
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export interface EscrowBidView {
  bidder: Hex;
  creator: Hex;
  amount: bigint;
  /** 0 Pending, 1 Accepted, 2 Rejected, 3 Refunded */
  status: number;
  createdAt: bigint;
  /** v2: the accepted reply's fingerprint (null if none). */
  replyHash: Hex | null;
  /** v1: the accepted reply's text (null if none). */
  replyText: string | null;
}

type RawBid = readonly [Hex, Hex, bigint, string, string, number, bigint];

/** getBid on any escrow generation, in one shape. */
export async function readEscrowBid(escrow: string, onChainBidId: string | bigint, blockNumber?: bigint): Promise<EscrowBidView> {
  const version = await escrowVersion(escrow);
  const raw = (await publicClient.readContract({
    address: escrow as Hex,
    abi: escrowAbiFor(version),
    functionName: "getBid",
    args: [BigInt(onChainBidId)],
    ...(blockNumber !== undefined ? { blockNumber } : {}),
  })) as unknown as RawBid;
  const reply = raw[4];
  return {
    bidder: raw[0],
    creator: raw[1],
    amount: raw[2],
    status: Number(raw[5]),
    createdAt: raw[6],
    replyHash: version === 2 && reply && reply !== zeroHash ? (reply as Hex) : null,
    replyText: version === 1 && reply ? reply : null,
  };
}

// ─── Pause (v2) ──────────────────────────────────────────────────────────────

const PAUSE_TTL_MS = 15_000;
const pausedCache = new Map<string, { at: number; paused: boolean }>();

/**
 * True while the escrow's owner has paused new bids. Cached 15 s. If it can't be
 * read, returns false: the contract itself refuses paused bids (no USDC moves), so
 * this check only gives users a clear message sooner.
 */
export async function escrowPaused(escrow: string | null | undefined): Promise<boolean> {
  if (!escrow) return false;
  const key = escrow.toLowerCase();
  const hit = pausedCache.get(key);
  if (hit && Date.now() - hit.at < PAUSE_TTL_MS) return hit.paused;
  try {
    if ((await escrowVersion(key)) !== 2) return false;
    const paused = (await publicClient.readContract({ address: key as Hex, abi: escrowAbi, functionName: "paused" })) as boolean;
    pausedCache.set(key, { at: Date.now(), paused });
    return paused;
  } catch (err) {
    console.warn("escrowPaused: could not read the pause flag", err);
    return false;
  }
}

/** Owner and handover state of a v2 escrow (null for v1). For the health check and preflight. */
export async function escrowAdmin(escrow: string): Promise<{ owner: Hex; pendingOwner: Hex; paused: boolean } | null> {
  if ((await escrowVersion(escrow)) !== 2) return null;
  const read = (functionName: "owner" | "pendingOwner" | "paused") =>
    publicClient.readContract({ address: escrow as Hex, abi: escrowAbi, functionName });
  const [owner, pendingOwner, paused] = await Promise.all([read("owner"), read("pendingOwner"), read("paused")]);
  return { owner: owner as Hex, pendingOwner: pendingOwner as Hex, paused: paused as boolean };
}
