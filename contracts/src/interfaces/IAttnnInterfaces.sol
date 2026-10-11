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

    /// @notice Replace the caller's floor, tags and profile URI (handle can't change)
    function updateProfile(uint256 minBid, string[] calldata tags, string calldata profileURI) external;

    event CreatorRegistered(address indexed creator, string handle, uint256 minBid);
    event CreatorUpdated(address indexed creator, uint256 minBid);
    event CreatorDeactivated(address indexed creator);
    event CreatorActivated(address indexed creator);
}

/// @notice Interface for the Attnn Escrow (v2: fingerprints instead of text, pause for new bids)
interface IAttnnEscrow {
    /// @notice Place a bid on a creator. `messageHash` = fingerprint(salt, message), or zero for no message.
    function placeBid(address creator, uint256 amount, bytes32 messageHash) external returns (uint256 bidId);

    /// @notice Accept a bid (creator only). `replyHash` = fingerprint(salt, reply); must not be zero.
    function acceptBid(uint256 bidId, bytes32 replyHash) external;

    /// @notice Reject a bid (creator only)
    function rejectBid(uint256 bidId) external;

    /// @notice Claim refund once REFUND_PERIOD has passed (bidder only)
    function claimRefund(uint256 bidId) external;

    /// @notice Stop new bids (owner only). Accept, reject and refund keep working.
    function pause() external;

    /// @notice Allow new bids again (owner only)
    function unpause() external;

    /// @notice Start handing the owner role to `newOwner` (zero cancels). It must call acceptOwnership().
    function transferOwnership(address newOwner) external;

    /// @notice Finish a handover started by transferOwnership (pending owner only)
    function acceptOwnership() external;

    /// @notice keccak256(salt ‖ text): how message and reply fingerprints are made
    function fingerprint(bytes32 salt, string calldata text) external pure returns (bytes32);

    /// @notice Get bid details
    function getBid(uint256 bidId) external view returns (address bidder, address creator, uint256 amount, bytes32 messageHash, bytes32 replyHash, uint8 status, uint256 createdAt);

    /// @notice Get all bid IDs for a creator
    function getCreatorBids(address creator) external view returns (uint256[] memory);

    /// @notice Get all bid IDs for a bidder
    function getBidderBids(address bidder) external view returns (uint256[] memory);

    /// @notice Get total bid count
    function getBidCount() external view returns (uint256);

    // Bid status: 0 = Pending, 1 = Accepted, 2 = Rejected, 3 = Refunded
    event BidPlaced(uint256 indexed bidId, address indexed bidder, address indexed creator, uint256 amount);
    event BidAccepted(uint256 indexed bidId, address indexed creator, bytes32 replyHash);
    event BidRejected(uint256 indexed bidId, address indexed creator);
    event BidRefunded(uint256 indexed bidId, address indexed bidder);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
}
