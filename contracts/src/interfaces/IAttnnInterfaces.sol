// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Interface for the Attnn Registry
interface IAttnnRegistry {
    /// @notice Register as a creator
    function registerCreator(string calldata handle, uint256 minBid, string[] calldata tags, string calldata profileURI) external;

    /// @notice Deactivate creator profile
    function deactivateCreator() external;

    /// @notice Reactivate creator profile
    function activateCreator() external;

    /// @notice Get creator profile by handle
    function getCreatorProfile(string calldata handle) external view returns (address creator, uint256 minBid, string[] memory tags, string memory profileURI, bool isActive);

    /// @notice Get all creator addresses by tag
    function getCreatorsByTag(string calldata tag) external view returns (address[] memory);

    /// @notice Check if a handle exists
    function creatorExists(string calldata handle) external view returns (bool);

    /// @notice Check if creator is active
    function isActiveCreator(address creator) external view returns (bool);

    event CreatorRegistered(address indexed creator, string handle, uint256 minBid);
    event CreatorDeactivated(address indexed creator);
    event CreatorActivated(address indexed creator);
}

/// @notice Interface for the Attnn Escrow
interface IAttnnEscrow {
    /// @notice Place a bid on a creator
    function placeBid(address creator, uint256 amount, string calldata message, bool isPrivate) external returns (uint256 bidId);

    /// @notice Accept a bid (creator only)
    function acceptBid(uint256 bidId, string calldata reply) external;

    /// @notice Reject a bid (creator only)
    function rejectBid(uint256 bidId) external;

    /// @notice Claim refund after 14 days (bidder only)
    function claimRefund(uint256 bidId) external;

    /// @notice Get bid details
    function getBid(uint256 bidId) external view returns (address bidder, address creator, uint256 amount, string memory message, string memory reply, uint8 status, uint256 createdAt);

    /// @notice Get all bid IDs for a creator
    function getCreatorBids(address creator) external view returns (uint256[] memory);

    /// @notice Get all bid IDs for a bidder
    function getBidderBids(address bidder) external view returns (uint256[] memory);

    /// @notice Get total bid count
    function getBidCount() external view returns (uint256);

    // Bid status: 0 = Pending, 1 = Accepted, 2 = Rejected, 3 = Refunded
    event BidPlaced(uint256 indexed bidId, address indexed bidder, address indexed creator, uint256 amount);
    event BidAccepted(uint256 indexed bidId, address indexed creator, string reply);
    event BidRejected(uint256 indexed bidId, address indexed creator);
    event BidRefunded(uint256 indexed bidId, address indexed bidder);
}
