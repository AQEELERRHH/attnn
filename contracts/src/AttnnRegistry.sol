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
    // Array of all creator addresses
    address[] private _allCreators;

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
        require(minBid >= 5 * 10**6, "AttnnRegistry: minBid too low (min 5 USDC)");
        require(minBid <= 1000 * 10**6, "AttnnRegistry: minBid too high (max 1000 USDC)");
        require(tags.length <= 10, "AttnnRegistry: too many tags");

        // Convert handle to lowercase for consistency
        string memory handleLower = _toLower(handle);

        Creator storage newCreator = _creators[msg.sender];
        newCreator.creator = msg.sender;
        newCreator.minBid = minBid;
        newCreator.tags = tags;
        newCreator.profileURI = profileURI;
        newCreator.isActive = true;

        _handleToCreator[handleLower] = msg.sender;
        _allCreators.push(msg.sender);

        // Add to tag mappings
        for (uint256 i = 0; i < tags.length; i++) {
            _tagToCreators[tags[i]].push(msg.sender);
        }

        emit CreatorRegistered(msg.sender, handle, minBid);
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