// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPriceOracle} from "../../src/interfaces/IPriceOracle.sol";

contract MockOracle is IPriceOracle {
    mapping(address => uint256) public prices;

    function setPrice(address token, uint256 priceE18) external {
        prices[token] = priceE18;
    }

    function price(address token) external view returns (uint256) {
        uint256 p = prices[token];
        require(p > 0, "MockOracle: unset");
        return p;
    }
}
