// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IAttnnEscrow} from "./interfaces/IAttnnInterfaces.sol";

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

/// @title AttnnEscrow
/// @notice Holds USDC bids for a creator's reply. A bid's USDC can only go to the
///         creator (when they reply in time) or back to the bidder (decline, or no
///         reply within REFUND_PERIOD). Nobody else can move it.
///
///         Privacy: bid messages and replies are never stored on-chain. Only their
///         fingerprints are: fingerprint(salt, text) = keccak256(salt ‖ text), with a
///         random 32-byte salt kept off-chain with the text. Anyone given the salt and
///         the text can check them against the stored fingerprint.
///
///         Admin: one `owner` address can pause NEW bids (placeBid) in an emergency,
///         and hand the role to another address in two steps. It has no other power:
///         accept, decline and refund keep working while paused, and the owner can
///         never move, freeze or redirect anyone's USDC.
contract AttnnEscrow is IAttnnEscrow {
    enum BidStatus {
        Pending,
        Accepted,
        Rejected,
        Refunded
    }

    struct Bid {
        address bidder;
        address creator;
        uint256 amount;
        bytes32 messageHash;
        bytes32 replyHash;
        BidStatus status;
        uint256 createdAt;
        uint256 updatedAt;
    }

    // USDC token address (6 decimals on Arc)
    address public immutable usdc;
    // AttnnRegistry address
    address public immutable registry;

    /// @notice The admin: may pause/unpause new bids and hand the role over. Nothing else.
    address public owner;
    /// @notice Address that may call acceptOwnership(), or zero when no handover is open.
    address public pendingOwner;
    /// @notice True while new bids are refused. Settlements are never paused.
    bool public paused;

    uint256 private _bidCounter;
    mapping(uint256 => Bid) private _bids;
    mapping(address => uint256[]) private _creatorBids;
    mapping(address => uint256[]) private _bidderBids;

    // Minimum bid amount (1 USDC, 6 decimals)
    uint256 public constant MIN_BID = 1 * 10**6;
    // Maximum bid amount (1000 USDC, 6 decimals)
    uint256 public constant MAX_BID = 1000 * 10**6;
    // Refund period (3 days in seconds)
    uint256 public constant REFUND_PERIOD = 3 days;

    modifier onlyOwner() {
        require(msg.sender == owner, "AttnnEscrow: not the owner");
        _;
    }

    constructor(address _usdc, address _registry, address _owner) {
        require(_usdc != address(0), "AttnnEscrow: zero USDC address");
        require(_registry != address(0), "AttnnEscrow: zero registry address");
        require(_owner != address(0), "AttnnEscrow: zero owner address");
        usdc = _usdc;
        registry = _registry;
        owner = _owner;
        emit OwnershipTransferred(address(0), _owner);
    }

    // ─── Bids ────────────────────────────────────────────────────────────────

    /// @inheritdoc IAttnnEscrow
    function placeBid(address creator, uint256 amount, bytes32 messageHash)
        external
        override
        returns (uint256 bidId)
    {
        require(!paused, "AttnnEscrow: new bids are paused");
        require(creator != address(0), "AttnnEscrow: zero creator address");
        require(creator != msg.sender, "AttnnEscrow: cannot bid on yourself");
        require(amount >= MIN_BID, "AttnnEscrow: amount below minimum");
        require(amount <= MAX_BID, "AttnnEscrow: amount above maximum");

        // Check creator is registered and active via registry
        (bool success, bytes memory data) = registry.staticcall(
            abi.encodeWithSignature("isActiveCreator(address)", creator)
        );
        require(success && data.length == 32 && abi.decode(data, (bool)), "AttnnEscrow: creator not active");

        // The creator's own minimum, not just the global one
        (success, data) = registry.staticcall(abi.encodeWithSignature("minBidOf(address)", creator));
        require(success && data.length == 32, "AttnnEscrow: creator minimum unavailable");
        require(amount >= abi.decode(data, (uint256)), "AttnnEscrow: amount below creator's minimum");

        // Record the bid before pulling the USDC (checks-effects-interactions).
        bidId = ++_bidCounter;
        Bid storage newBid = _bids[bidId];
        newBid.bidder = msg.sender;
        newBid.creator = creator;
        newBid.amount = amount;
        newBid.messageHash = messageHash;
        newBid.status = BidStatus.Pending;
        newBid.createdAt = block.timestamp;
        newBid.updatedAt = block.timestamp;

        _creatorBids[creator].push(bidId);
        _bidderBids[msg.sender].push(bidId);

        require(
            IERC20(usdc).transferFrom(msg.sender, address(this), amount),
            "AttnnEscrow: USDC transfer failed"
        );

        emit BidPlaced(bidId, msg.sender, creator, amount);
    }

    /// @inheritdoc IAttnnEscrow
    function acceptBid(uint256 bidId, bytes32 replyHash) external override {
        Bid storage bid = _bids[bidId];
        require(bid.creator == msg.sender, "AttnnEscrow: not the creator");
        require(bid.status == BidStatus.Pending, "AttnnEscrow: bid not pending");
        require(bid.createdAt + REFUND_PERIOD > block.timestamp, "AttnnEscrow: bid expired");
        require(replyHash != bytes32(0), "AttnnEscrow: empty reply");

        // Settle first, pay second (checks-effects-interactions): the bid can't be
        // settled twice even if the token ever called back into this contract.
        bid.status = BidStatus.Accepted;
        bid.replyHash = replyHash;
        bid.updatedAt = block.timestamp;

        require(
            IERC20(usdc).transfer(bid.creator, bid.amount),
            "AttnnEscrow: USDC transfer to creator failed"
        );

        emit BidAccepted(bidId, msg.sender, replyHash);
    }

    /// @inheritdoc IAttnnEscrow
    function rejectBid(uint256 bidId) external override {
        Bid storage bid = _bids[bidId];
        require(bid.creator == msg.sender, "AttnnEscrow: not the creator");
        require(bid.status == BidStatus.Pending, "AttnnEscrow: bid not pending");

        bid.status = BidStatus.Rejected;
        bid.updatedAt = block.timestamp;

        require(
            IERC20(usdc).transfer(bid.bidder, bid.amount),
            "AttnnEscrow: USDC refund failed"
        );

        emit BidRejected(bidId, msg.sender);
    }

    /// @inheritdoc IAttnnEscrow
    function claimRefund(uint256 bidId) external override {
        Bid storage bid = _bids[bidId];
        require(bid.bidder == msg.sender, "AttnnEscrow: not the bidder");
        require(bid.status == BidStatus.Pending, "AttnnEscrow: bid not pending");
        require(bid.createdAt + REFUND_PERIOD <= block.timestamp, "AttnnEscrow: refund period not passed");

        bid.status = BidStatus.Refunded;
        bid.updatedAt = block.timestamp;

        require(
            IERC20(usdc).transfer(bid.bidder, bid.amount),
            "AttnnEscrow: USDC refund failed"
        );

        emit BidRefunded(bidId, msg.sender);
    }

    // ─── Admin (pause new bids only) ─────────────────────────────────────────

    /// @inheritdoc IAttnnEscrow
    function pause() external override onlyOwner {
        require(!paused, "AttnnEscrow: already paused");
        paused = true;
        emit Paused(msg.sender);
    }

    /// @inheritdoc IAttnnEscrow
    function unpause() external override onlyOwner {
        require(paused, "AttnnEscrow: not paused");
        paused = false;
        emit Unpaused(msg.sender);
    }

    /// @inheritdoc IAttnnEscrow
    function transferOwnership(address newOwner) external override onlyOwner {
        pendingOwner = newOwner; // zero cancels an open handover
        emit OwnershipTransferStarted(msg.sender, newOwner);
    }

    /// @inheritdoc IAttnnEscrow
    function acceptOwnership() external override {
        require(msg.sender == pendingOwner, "AttnnEscrow: not the pending owner");
        address previous = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(previous, msg.sender);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /// @inheritdoc IAttnnEscrow
    function fingerprint(bytes32 salt, string calldata text) external pure override returns (bytes32) {
        return keccak256(abi.encodePacked(salt, text));
    }

    /// @inheritdoc IAttnnEscrow
    function getBid(uint256 bidId) external view override returns (
        address bidder,
        address creator,
        uint256 amount,
        bytes32 messageHash,
        bytes32 replyHash,
        uint8 status,
        uint256 createdAt
    ) {
        Bid storage bid = _bids[bidId];
        return (
            bid.bidder,
            bid.creator,
            bid.amount,
            bid.messageHash,
            bid.replyHash,
            uint8(bid.status),
            bid.createdAt
        );
    }

    /// @inheritdoc IAttnnEscrow
    function getCreatorBids(address creator) external view override returns (uint256[] memory) {
        return _creatorBids[creator];
    }

    /// @inheritdoc IAttnnEscrow
    function getBidderBids(address bidder) external view override returns (uint256[] memory) {
        return _bidderBids[bidder];
    }

    /// @notice Number of bids ever placed to `creator`
    function getCreatorBidCount(address creator) external view returns (uint256) {
        return _creatorBids[creator].length;
    }

    /// @notice Number of bids ever placed by `bidder`
    function getBidderBidCount(address bidder) external view returns (uint256) {
        return _bidderBids[bidder].length;
    }

    /// @notice Up to `limit` of `creator`'s bid ids, oldest first, from `offset`
    function getCreatorBidsPage(address creator, uint256 offset, uint256 limit) external view returns (uint256[] memory) {
        return _page(_creatorBids[creator], offset, limit);
    }

    /// @notice Up to `limit` of `bidder`'s bid ids, oldest first, from `offset`
    function getBidderBidsPage(address bidder, uint256 offset, uint256 limit) external view returns (uint256[] memory) {
        return _page(_bidderBids[bidder], offset, limit);
    }

    function _page(uint256[] storage all, uint256 offset, uint256 limit) private view returns (uint256[] memory page) {
        if (offset >= all.length) return new uint256[](0);
        uint256 end = all.length - offset < limit ? all.length : offset + limit;
        page = new uint256[](end - offset);
        for (uint256 i = offset; i < end; i++) page[i - offset] = all[i];
    }

    /// @inheritdoc IAttnnEscrow
    function getBidCount() external view override returns (uint256) {
        return _bidCounter;
    }

    /// @notice Get total USDC locked in escrow
    function getTotalLocked() external view returns (uint256) {
        return IERC20(usdc).balanceOf(address(this));
    }

    /// @notice Check if a bid is refundable (pending and past refund period)
    function isRefundable(uint256 bidId) external view returns (bool) {
        Bid storage bid = _bids[bidId];
        return bid.status == BidStatus.Pending && bid.createdAt + REFUND_PERIOD <= block.timestamp;
    }
}
