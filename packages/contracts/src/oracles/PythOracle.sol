// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {IPyth} from "../interfaces/external/IPyth.sol";

/// @title PythOracle
/// @notice Token → Pyth feed mapping. Returns USD per whole token scaled to 1e18; reverts when stale.
contract PythOracle is IPriceOracle, Ownable {
    IPyth public immutable pyth;
    uint256 public maxAge;
    mapping(address => bytes32) public feedOf;

    event FeedSet(address indexed token, bytes32 feedId);
    event MaxAgeUpdated(uint256 maxAge);

    error FeedNotSet(address token);
    error InvalidPrice(address token);

    constructor(address pyth_, address owner_, uint256 maxAge_) Ownable(owner_) {
        pyth = IPyth(pyth_);
        maxAge = maxAge_;
    }

    function setFeed(address token, bytes32 feedId) external onlyOwner {
        feedOf[token] = feedId;
        emit FeedSet(token, feedId);
    }

    function setMaxAge(uint256 maxAge_) external onlyOwner {
        maxAge = maxAge_;
        emit MaxAgeUpdated(maxAge_);
    }

    function price(address token) external view returns (uint256) {
        bytes32 id = feedOf[token];
        if (id == bytes32(0)) revert FeedNotSet(token);
        IPyth.Price memory p = pyth.getPriceNoOlderThan(id, maxAge);
        if (p.price <= 0) revert InvalidPrice(token);
        uint256 base = uint256(uint64(p.price));
        if (p.expo <= 0) {
            return base * 1e18 / 10 ** uint256(uint32(-p.expo));
        }
        return base * 1e18 * 10 ** uint256(uint32(p.expo));
    }
}
