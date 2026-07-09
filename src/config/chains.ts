// Chain config + deployed contract addresses for MegaETH (mainnet 4326, testnet 6343).
// Sources: integrator-kit/addresses/*.json, fire/addresses + frontend constants/fire.ts.
// Fire uses the custom POOL_INIT_CODE_HASH baked into @kumbaya_xyz/v3-sdk.
import { defineChain } from "viem";

export type ChainId = 4326 | 6343;

export interface Addresses {
  factory: `0x${string}`;
  positionManager: `0x${string}`;
  swapRouter02: `0x${string}`;
  quoterV2: `0x${string}`;
  universalRouter: `0x${string}`;
  permit2: `0x${string}`;
  weth9: `0x${string}`;
  tickLens: `0x${string}`;
  multicall3: `0x${string}`;
  // Fire protocol
  fireRegistry: `0x${string}`;
  fireLaunch: `0x${string}`;
  fireStream: `0x${string}`;
  fireGraduator: `0x${string}`;
  fuelVault: `0x${string}`;
}

export interface ChainConfig {
  id: ChainId;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  isTestnet: boolean;
  addresses: Addresses;
}

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
const WETH9 = "0x4200000000000000000000000000000000000006" as const;

export const CHAINS: Record<ChainId, ChainConfig> = {
  4326: {
    id: 4326,
    name: "MegaETH",
    rpcUrl: "https://mainnet.megaeth.com/rpc",
    explorerUrl: "https://mega.etherscan.io",
    isTestnet: false,
    addresses: {
      factory: "0x68b34591f662508076927803c567Cc8006988a09",
      positionManager: "0x2b781C57e6358f64864Ff8EC464a03Fdaf9974bA",
      swapRouter02: "0xE5BbEF8De2DB447a7432A47EBa58924d94eE470e",
      quoterV2: "0x1F1a8dC7E138C34b503Ca080962aC10B75384a27",
      universalRouter: "0xAAB1C664CeaD881AfBB58555e6A3a79523D3e4C0",
      permit2: PERMIT2,
      weth9: WETH9,
      tickLens: "0x9c22f028e0a1dc76EB895a1929DBc517c9D0593e",
      multicall3: MULTICALL3,
      fireRegistry: "0x286B4CB284270C6aE2844875BC92ed7E4C21c4C6",
      fireLaunch: "0x69FE0908F1211dE66F7067021998f28A5693ABbD",
      fireStream: "0x94d9582130745d0e2a1757dDEd8e730F5CDAd759",
      fireGraduator: "0xCCA4759167Ef4214dF98Eb7cBbCE47EB9B4F2585",
      fuelVault: "0x5aFaB54ac28a3bd485751146470D053b4FF11c81",
    },
  },
  6343: {
    id: 6343,
    name: "MegaETH Testnet",
    rpcUrl: "https://carrot.megaeth.com/rpc",
    explorerUrl: "https://testnet-mega.etherscan.io",
    isTestnet: true,
    addresses: {
      factory: "0x53447989580f541bc138d29A0FcCf72AfbBE1355",
      positionManager: "0x367f9db1F974eA241ba046b77B87C58e2947d8dF",
      swapRouter02: "0x8268DC930BA98759E916DEd4c9F367A844814023",
      quoterV2: "0xfb230b93803F90238cB03f254452bA3a3b0Ec38d",
      universalRouter: "0x7E6c4Ada91e432efe5F01FbCb3492Bd3eb7ccD2E",
      permit2: PERMIT2,
      weth9: WETH9,
      tickLens: "0x6D65B4854944Fd93Cd568bb1B54EE22Fe9BF2faa",
      multicall3: MULTICALL3,
      fireRegistry: "0xaB31c1f84e9c7CcE928a27A8b77fC7De7C310EcA",
      fireLaunch: "0xB710b3fe1002eeC1E4b451502f46bC384c823522",
      fireStream: "0x65c62D7219Cc86E58636aA6589f60A43F389560A",
      fireGraduator: "0x88E0cC07b308FB07038Be48203a0619E281d2ac7",
      fuelVault: "0x37494B27b429b539a4048D19de4a015025B07662",
    },
  },
};

// Default chain: testnet-first, per the Kumbaya agents' ground rules. Override with CHAIN_ID.
export const DEFAULT_CHAIN_ID: ChainId = (Number(process.env.CHAIN_ID) as ChainId) in CHAINS
  ? (Number(process.env.CHAIN_ID) as ChainId)
  : 6343;

// Exchange API base for the public, keyless pools/admitted routing endpoint.
export const EXCHANGE_API_URL =
  process.env.KUMBAYA_EXCHANGE_URL?.replace(/\/$/, "") || "https://exchange.kumbaya.xyz";

export function getChain(chainId: ChainId): ChainConfig {
  const c = CHAINS[chainId];
  if (!c) throw new Error(`Unsupported chainId ${chainId}. Use 4326 (mainnet) or 6343 (testnet).`);
  return c;
}

export function viemChain(chainId: ChainId) {
  const c = getChain(chainId);
  return defineChain({
    id: c.id,
    name: c.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [c.rpcUrl] } },
    blockExplorers: { default: { name: "Explorer", url: c.explorerUrl } },
    contracts: { multicall3: { address: c.addresses.multicall3 } },
  });
}
