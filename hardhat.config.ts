import 'dotenv/config';
import '@nomicfoundation/hardhat-ethers';
import '@nomicfoundation/hardhat-chai-matchers';
import type { HardhatUserConfig } from 'hardhat/config';

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || '';
const PRIVATE_KEY = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.28',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {},
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: PRIVATE_KEY,
    },
  },
  paths: {
    sources: './contracts',
    tests: './test/contract',
    cache: './cache',
    artifacts: './artifacts',
  },
};

export default config;
