"""Tool schemas the model sees."""

_HANDLE = {"type": "string", "description": "Creator handle on Attnn., without the @ (e.g. emdee002)."}
_BID_ID = {"type": "string", "description": "Bid id returned by attnn_place_bid."}


def _schema(name: str, description: str, properties: dict, required: list[str] | None = None) -> dict:
    return {
        "name": name,
        "description": description,
        "parameters": {
            "type": "object",
            "properties": properties,
            "required": required or [],
            "additionalProperties": False,
        },
    }


FIND_CREATORS = _schema(
    "attnn_find_creators",
    "List live creator markets on Attnn. you can bid on, optionally by topic tag. Free. Returns "
    "each creator's handle, tags, floor (minimum bid in USDC) and verified social accounts.",
    {
        "tag": {"type": "string", "description": "One topic tag, exact match (e.g. 'web3', 'design'). Omit for all."},
        "limit": {"type": "integer", "minimum": 1, "maximum": 100, "description": "Max results (default 20)."},
    },
)

READ_PROFILE = _schema(
    "attnn_read_profile",
    "Read one creator's full profile (bio, what they're open to, availability, floor). Costs "
    "$0.001 USDC from the agent's read balance; reading again within 24 h is free. Read before "
    "bidding: Attnn. only accepts bids from a wallet that read that creator in the last 24 h.",
    {"handle": _HANDLE},
    ["handle"],
)

WALLET_STATUS = _schema(
    "attnn_wallet_status",
    "Show the agent wallet: address, network, USDC balance, profile-read balance, today's spend "
    "and the caps the user set. Free; use it before bidding or when a payment fails.",
    {},
)

FUND_READS = _schema(
    "attnn_fund_reads",
    "Move USDC from the agent wallet into its profile-read balance (Circle Gateway), which pays "
    "$0.001 per profile read. Sends two Arc transactions; the user is asked to approve first. "
    "A few cents covers many reads.",
    {"amount_usd": {"type": "number", "exclusiveMinimum": 0, "description": "USDC to move, e.g. 0.10."}},
    ["amount_usd"],
)

PLACE_BID = _schema(
    "attnn_place_bid",
    "Bid USDC on a creator from the agent's own wallet. The USDC goes into Attnn.'s escrow: the "
    "creator is paid only if they reply (100+ characters), a decline refunds at once, and with no "
    "reply in 3 days the agent can claim it back. The user is asked to approve every bid, and "
    "bids above the per-bid cap or today's budget are refused. Read the profile first.",
    {
        "handle": _HANDLE,
        "amount_usd": {
            "type": "number",
            "exclusiveMinimum": 0,
            "description": "Bid in USDC. Omit to bid exactly the creator's floor.",
        },
        "message": {
            "type": "string",
            "maxLength": 2000,
            "description": "What you want from the creator. Private: only its fingerprint goes on-chain.",
        },
    },
    ["handle"],
)

BID_STATUS = _schema(
    "attnn_bid_status",
    "Check a bid: waiting / pending / accepted (with the creator's reply) / rejected / refunded, "
    "and when an unanswered bid becomes refundable. Free.",
    {"bid_id": _BID_ID},
    ["bid_id"],
)

LIST_BIDS = _schema(
    "attnn_list_bids",
    "List bids this agent placed, newest first, with their last known status. Free; no network calls.",
    {},
)

CLAIM_REFUND = _schema(
    "attnn_claim_refund",
    "Take back an unanswered bid after its refund date (3 days). Sends one Arc transaction from "
    "the agent wallet; the user is asked to approve first.",
    {"bid_id": _BID_ID},
    ["bid_id"],
)
