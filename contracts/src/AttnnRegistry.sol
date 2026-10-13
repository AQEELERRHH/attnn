// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IAttnnRegistry} from "./interfaces/IAttnnInterfaces.sol";

/// @title AttnnRegistry
/// @notice Registry for creator profiles on the Attnn marketplace
contract AttnnRegistry is IAttnnRegistry {
    struct Creator {
        address creator;
        uint256 minBid;
        string[] tags;
        string profileURI;
        bool isActive;
    }

    // Mapping from creator address to Creator struct
    mapping(address => Creator) private _creators;
    // Mapping from handle (lowercase) to creator address
    mapping(string => address) private _handleToCreator;
    // Mapping from tag to list of creator addresses
    mapping(string => address[]) private _tagToCreators;
    // Position + 1 of a creator in _tagToCreators[tag] (0 = not listed), so a tag
    // can be removed in O(1) and never listed twice
    mapping(string => mapping(address => uint256)) private _tagSlot;
    // Array of all creator addresses
    address[] private _allCreators;

    uint256 private constant MIN_FLOOR = 1 * 10**6;
    uint256 private constant MAX_FLOOR = 1000 * 10**6;
    uint256 private constant MAX_TAGS = 10;

    modifier onlyCreator() {
        require(_creators[msg.sender].creator != address(0), "AttnnRegistry: not a registered creator");
        _;
    }

    /// @inheritdoc IAttnnRegistry
    function registerCreator(
        string calldata handle,
        uint256 minBid,
        string[] calldata tags,
        string calldata profileURI
    ) external override {
        require(msg.sender != address(0), "AttnnRegistry: zero address");
        require(_creators[msg.sender].creator == address(0), "AttnnRegistry: already registered");
        require(!creatorExists(handle), "AttnnRegistry: handle already taken");
        _checkProfile(minBid, tags);

        // Convert handle to lowercase for consistency
        string memory handleLower = _toLower(handle);

        Creator storage newCreator = _creators[msg.sender];
        newCreator.creator = msg.sender;
        newCreator.minBid = minBid;
        newCreator.profileURI = profileURI;
        newCreator.isActive = true;
        _setTags(msg.sender, tags);

        _handleToCreator[handleLower] = msg.sender;
        _allCreators.push(msg.sender);

        emit CreatorRegistered(msg.sender, handle, minBid);
    }

    /// @inheritdoc IAttnnRegistry
    function updateProfile(
        uint256 minBid,
        string[] calldata tags,
        string calldata profileURI
    ) external override onlyCreator {
        _checkProfile(minBid, tags);

        Creator storage c = _creators[msg.sender];
        c.minBid = minBid;
        c.profileURI = profileURI;

        // Drop the old tags from the tag index, then list the new ones
        string[] storage old = c.tags;
        for (uint256 i = 0; i < old.length; i++) {
            _unlistTag(old[i], msg.sender);
        }
        _setTags(msg.sender, tags);

        emit CreatorUpdated(msg.sender, minBid);
    }

    /// @inheritdoc IAttnnRegistry
    function deactivateCreator() external override onlyCreator {
        require(_creators[msg.sender].isActive, "AttnnRegistry: already deactivated");
        _creators[msg.sender].isActive = false;
        emit CreatorDeactivated(msg.sender);
    }

    /// @inheritdoc IAttnnRegistry
    function activateCreator() external override onlyCreator {
        require(!_creators[msg.sender].isActive, "AttnnRegistry: already active");
        _creators[msg.sender].isActive = true;
        emit CreatorActivated(msg.sender);
    }

    /// @inheritdoc IAttnnRegistry
    function getCreatorProfile(string calldata handle) external view override returns (
        address creator,
        uint256 minBid,
        string[] memory tags,
        string memory profileURI,
        bool isActive
    ) {
        string memory handleLower = _toLower(handle);
        address creatorAddr = _handleToCreator[handleLower];
        require(creatorAddr != address(0), "AttnnRegistry: creator not found");

        Creator storage c = _creators[creatorAddr];
        return (c.creator, c.minBid, c.tags, c.profileURI, c.isActive);
    }

    /// @inheritdoc IAttnnRegistry
    function getCreatorsByTag(string calldata tag) external view override returns (address[] memory) {
        return _tagToCreators[tag];
    }

    /// @inheritdoc IAttnnRegistry
    function creatorExists(string calldata handle) public view override returns (bool) {
        string memory handleLower = _toLower(handle);
        return _handleToCreator[handleLower] != address(0);
    }

    /// @inheritdoc IAttnnRegistry
    function isActiveCreator(address creator) external view override returns (bool) {
        return _creators[creator].isActive;
    }

    /// @notice Get total number of registered creators
    function getCreatorCount() external view returns (uint256) {
        return _allCreators.length;
    }

    function _checkProfile(uint256 minBid, string[] calldata tags) internal pure {
        require(minBid >= MIN_FLOOR, "AttnnRegistry: minBid too low (min 1 USDC)");
        require(minBid <= MAX_FLOOR, "AttnnRegistry: minBid too high (max 1000 USDC)");
        require(tags.length <= MAX_TAGS, "AttnnRegistry: too many tags");
    }

    /// @dev Stores `tags` as the creator's tag list and lists the creator under each,
    ///      skipping duplicates. Callers must have unlisted any previous tags.
    function _setTags(address creator, string[] calldata tags) internal {
        string[] storage stored = _creators[creator].tags;
        while (stored.length > 0) stored.pop();
        for (uint256 i = 0; i < tags.length; i++) {
            if (_tagSlot[tags[i]][creator] != 0) continue; // duplicate in the input
            _tagToCreators[tags[i]].push(creator);
            _tagSlot[tags[i]][creator] = _tagToCreators[tags[i]].length;
            stored.push(tags[i]);
        }
    }

    /// @dev Removes `creator` from `tag`'s list (swap with the last entry, then pop).
    function _unlistTag(string memory tag, address creator) internal {
        uint256 slot = _tagSlot[tag][creator];
        if (slot == 0) return;
        address[] storage list = _tagToCreators[tag];
        address last = list[list.length - 1];
        list[slot - 1] = last;
        _tagSlot[tag][last] = slot;
        list.pop();
        delete _tagSlot[tag][creator];
    }

    /// @notice Internal helper to convert string to lowercase
    function _toLower(string memory str) internal pure returns (string memory) {
        bytes memory bStr = bytes(str);
        bytes memory bLower = new bytes(bStr.length);
        for (uint256 i = 0; i < bStr.length; i++) {
            // Uppercase A-Z -> lowercase a-z
            if ((uint8(bStr[i]) >= 65) && (uint8(bStr[i]) <= 90)) {
                bLower[i] = bytes1(uint8(bStr[i]) + 32);
            } else {
                bLower[i] = bStr[i];
            }
        }
        return string(bLower);
    }
}