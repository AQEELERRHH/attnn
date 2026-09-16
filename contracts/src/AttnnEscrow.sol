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
/// @notice Escrow contract for bids on creator attention
contract AttnnEscrow is IAttnnEscrow {
    // Bid status enum
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
        string message;
        string reply;
        BidStatus status;
        uint256 createdAt;
        uint256 updatedAt;
    }

    // USDC token address (6 decimals on Arc)
    address public immutable usdc;
    // AttnnRegistry address
    address public immutable registry;

    // Bid ID counter
    uint256 private _bidCounter;
    // Mapping from bid ID to Bid struct
    mapping(uint256 => Bid) private _bids;
    // Mapping from creator to list of bid IDs
    mapping(address => uint256[]) private _creatorBids;
    // Mapping from bidder to list of bid IDs
    mapping(address => uint256[]) private _bidderBids;

    // Minimum bid amount (5 USDC, 6 decimals)
    uint256 public constant MIN_BID = 5 * 10**6;
    // Maximum bid amount (1000 USDC, 6 decimals)
    uint256 public constant MAX_BID = 1000 * 10**6;
    // Refund period (14 days in seconds)
    uint256 public constant REFUND_PERIOD = 14 days;

    constructor(address _usdc, address _registry) {
        require(_usdc != address(0), "AttnnEscrow: zero USDC address");
        require(_registry != address(0), "AttnnEscrow: zero registry address");
        usdc = _usdc;
        registry = _registry;
    }

    /// @inheritdoc IAttnnEscrow
    function placeBid(
        address creator,
        uint256 amount,
        string calldata message,
        bool isPrivate
    ) external override returns (uint256 bidId) {
        require(creator != address(0), "AttnnEscrow: zero creator address");
        require(creator != msg.sender, "AttnnEscrow: cannot bid on yourself");
        require(amount >= MIN_BID, "AttnnEscrow: amount below minimum");
        require(amount <= MAX_BID, "AttnnEscrow: amount above maximum");
        
        // Check creator is registered and active via registry
        (bool success, bytes memory data) = registry.staticcall(
            abi.encodeWithSignature("isActiveCreator(address)", creator)
        );
        require(success && abi.decode(data, (bool)), "AttnnEscrow: creator not active");

        // Transfer USDC from bidder to escrow
        require(
            IERC20(usdc).transferFrom(msg.sender, address(this), amount),
            "AttnnEscrow: USDC transfer failed"
        );

        bidId = ++_bidCounter;
        Bid storage newBid = _bids[bidId];
        newBid.bidder = msg.sender;
        newBid.creator = creator;
        newBid.amount = amount;
        newBid.message = isPrivate ? "" : message;
        newBid.status = BidStatus.Pending;
        newBid.createdAt = block.timestamp;
        newBid.updatedAt = block.timestamp;

        _creatorBids[creator].push(bidId);
        _bidderBids[msg.sender].push(bidId);

        emit BidPlaced(bidId, msg.sender, creator, amount);
        return bidId;
    }

    /// @inheritdoc IAttnnEscrow
    function acceptBid(uint256 bidId, string calldata reply) external override {
        Bid storage bid = _bids[bidId];
        require(bid.creator == msg.sender, "AttnnEscrow: not the creator");
        require(bid.status == BidStatus.Pending, "AttnnEscrow: bid not pending");
        require(bid.createdAt + REFUND_PERIOD > block.timestamp, "AttnnEscrow: bid expired");

        // Transfer USDC to creator
        require(
            IERC20(usdc).transfer(bid.creator, bid.amount),
            "AttnnEscrow: USDC transfer to creator failed"
        );

        bid.status = BidStatus.Accepted;
        bid.reply = reply;
        bid.updatedAt = block.timestamp;

        emit BidAccepted(bidId, msg.sender, reply);
    }

    /// @inheritdoc IAttnnEscrow
    function rejectBid(uint256 bidId) external override {
        Bid storage bid = _bids[bidId];
        require(bid.creator == msg.sender, "AttnnEscrow: not the creator");
        require(bid.status == BidStatus.Pending, "AttnnEscrow: bid not pending");

        // Refund USDC to bidder
        require(
            IERC20(usdc).transfer(bid.bidder, bid.amount),
            "AttnnEscrow: USDC refund failed"
        );

        bid.status = BidStatus.Rejected;
        bid.updatedAt = block.timestamp;

        emit BidRejected(bidId, msg.sender);
    }

    /// @inheritdoc IAttnnEscrow
    function claimRefund(uint256 bidId) external override {
        Bid storage bid = _bids[bidId];
        require(bid.bidder == msg.sender, "AttnnEscrow: not the bidder");
        require(bid.status == BidStatus.Pending, "AttnnEscrow: bid not pending");
        require(bid.createdAt + REFUND_PERIOD <= block.timestamp, "AttnnEscrow: refund period not passed");

        // Refund USDC to bidder
        require(
            IERC20(usdc).transfer(bid.bidder, bid.amount),
            "AttnnEscrow: USDC refund failed"
        );

        bid.status = BidStatus.Refunded;
        bid.updatedAt = block.timestamp;

        emit BidRefunded(bidId, msg.sender);
    }

    /// @inheritdoc IAttnnEscrow
    function getBid(uint256 bidId) external view override returns (
        address bidder,
        address creator,
        uint256 amount,
        string memory message,
        string memory reply,
        uint8 status,
        uint256 createdAt
    ) {
        Bid storage bid = _bids[bidId];
        return (
            bid.bidder,
            bid.creator,
            bid.amount,
            bid.message,
            bid.reply,
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