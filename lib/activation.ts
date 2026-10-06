import { publicClient, usdcAbi, USDC_ADDRESS } from "./arc";

/**
 * Creators pay their own gas on Arc (in USDC) for registerCreator and for
 * accepting or rejecting bids. Wallets aren't gas-sponsored yet, so activation
 * requires a small balance first.
 */
export const ACTIVATION_MIN_USDC = BigInt(1_000_000); // $1.00 (6 decimals)

export const ACTIVATION_FUNDS_MESSAGE =
  "Add at least $1 USDC to your wallet to activate. It covers the small network fees for registering on Arc and replying to bids.";

/** USDC balance (atomic, 6 decimals) of an address, read from Arc. */
export async function getUsdcBalance(address: string): Promise<bigint> {
  return publicClient.readContract({
    address: USDC_ADDRESS as `0x${string}`,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
  });
}
