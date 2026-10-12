import {
  BrowserProvider,
  Contract,
  formatEther,
  isAddress,
  parseEther,
  type Eip1193Provider,
  type InterfaceAbi,
} from 'ethers'
import marketplaceAbi from '../contracts/ComputeMarketplace.json'

export { encodeCanonicalMatrixInputs, parseIntegerMatrix } from './matrix-input'
export type { IntegerMatrix } from './matrix-input'

export interface InjectedEthereum extends Eip1193Provider {
  on(_event: 'accountsChanged', _listener: (accounts: string[]) => void): void
  on(_event: 'chainChanged', _listener: (chainId: string) => void): void
  removeListener(_event: 'accountsChanged', _listener: (accounts: string[]) => void): void
  removeListener(_event: 'chainChanged', _listener: (chainId: string) => void): void
}

export interface MarketplaceConfig {
  address: string | null
  addressError: string | null
  chainId: bigint | null
  chainError: string | null
}

export interface MarketplaceSnapshot {
  approvedImageId: string
  nextJobId: bigint
}

export type MarketplaceJobStatus = 'None' | 'Created' | 'Accepted' | 'Completed' | 'Cancelled'

export interface MarketplaceJob {
  id: bigint
  requester: string
  worker: string
  reward: bigint
  imageId: string
  status: MarketplaceJobStatus
  createdAt: bigint
}

export interface CreateJobResult {
  jobId: bigint
  transactionHash: string
}

export const RECENT_JOBS_PAGE_SIZE = 10

const JOB_STATUS_LABELS: MarketplaceJobStatus[] = [
  'None',
  'Created',
  'Accepted',
  'Completed',
  'Cancelled',
]

export function getInjectedEthereum(): InjectedEthereum | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as Window & { ethereum?: InjectedEthereum }).ethereum
}

export function getMarketplaceConfig(): MarketplaceConfig {
  const configuredAddress = import.meta.env.VITE_MARKETPLACE_ADDRESS?.trim()
  let address: string | null = null
  let addressError: string | null = null

  if (!configuredAddress) {
    addressError = 'Set VITE_MARKETPLACE_ADDRESS in frontend/.env.local to connect to a deployed marketplace.'
  } else if (!isAddress(configuredAddress)) {
    addressError = 'VITE_MARKETPLACE_ADDRESS is not a valid Ethereum address.'
  } else {
    address = configuredAddress
  }

  const configuredChainId = import.meta.env.VITE_CHAIN_ID?.trim()
  let chainId: bigint | null = null
  let chainError: string | null = null
  if (!configuredChainId) {
    chainError = 'Set VITE_CHAIN_ID to the chain ID where this marketplace is deployed.'
  } else if (!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(configuredChainId)) {
    chainError = 'VITE_CHAIN_ID must be a decimal or 0x-prefixed hexadecimal chain ID.'
  } else {
    try {
      chainId = BigInt(configuredChainId)
      if (chainId <= 0n) {
        chainId = null
        chainError = 'VITE_CHAIN_ID must be greater than zero.'
      }
    } catch {
      chainError = 'VITE_CHAIN_ID is not a valid chain ID.'
    }
  }

  return { address, addressError, chainId, chainError }
}

export async function connectWallet(injected: InjectedEthereum): Promise<string> {
  const provider = new BrowserProvider(injected)
  const accounts = (await provider.send('eth_requestAccounts', [])) as string[]
  const account = accounts[0]
  if (!account) throw new Error('MetaMask did not return an account. Unlock the wallet and try again.')
  return account
}

export async function getWalletAccount(injected: InjectedEthereum): Promise<string | null> {
  const provider = new BrowserProvider(injected)
  const accounts = (await provider.send('eth_accounts', [])) as string[]
  return accounts[0] ?? null
}

export async function getWalletChainId(injected: InjectedEthereum): Promise<bigint> {
  const provider = new BrowserProvider(injected)
  return (await provider.getNetwork()).chainId
}

export async function getMarketplaceSnapshot(
  address: string,
  injected: InjectedEthereum,
): Promise<MarketplaceSnapshot> {
  const provider = new BrowserProvider(injected)
  const contract = new Contract(address, marketplaceAbi as InterfaceAbi, provider)
  const [approvedImageId, nextJobId] = await Promise.all([
    contract.getFunction('approvedImageId')(),
    contract.getFunction('nextJobId')(),
  ])

  return {
    approvedImageId: approvedImageId as string,
    nextJobId: nextJobId as bigint,
  }
}

export async function getRecentJobs(
  address: string,
  injected: InjectedEthereum,
  targetChainId: bigint,
): Promise<MarketplaceJob[]> {
  const provider = new BrowserProvider(injected)
  const network = await provider.getNetwork()
  if (network.chainId !== targetChainId) {
    throw new Error(
      `Wrong network: connected to chain ${network.chainId.toString()}, expected ${targetChainId.toString()}.`,
    )
  }

  const contract = new Contract(address, marketplaceAbi as InterfaceAbi, provider)
  const nextJobId = (await contract.getFunction('nextJobId')()) as bigint
  const firstJobId = nextJobId > BigInt(RECENT_JOBS_PAGE_SIZE)
    ? nextJobId - BigInt(RECENT_JOBS_PAGE_SIZE)
    : 1n
  const jobIds: bigint[] = []
  for (let jobId = nextJobId - 1n; jobId >= firstJobId; jobId -= 1n) {
    jobIds.push(jobId)
  }

  return Promise.all(
    jobIds.map(async (jobId): Promise<MarketplaceJob> => {
      try {
        const job = await contract.getFunction('getJob')(jobId)
        const statusIndex = Number(job.status)
        const status = JOB_STATUS_LABELS[statusIndex]
        if (!status) {
          throw new Error(`Contract returned an unknown status value (${statusIndex}).`)
        }

        return {
          id: job.id as bigint,
          requester: job.requester as string,
          worker: job.worker as string,
          reward: job.reward as bigint,
          imageId: job.imageId as string,
          status,
          createdAt: job.createdAt as bigint,
        }
      } catch (cause) {
        throw new Error(
          `Unable to read job ${jobId.toString()}: ${toUserMessage(cause)}`,
          { cause },
        )
      }
    }),
  )
}

export function parsePositiveEther(reward: string): bigint {
  const normalized = reward.trim()
  if (!normalized) throw new Error('Enter a reward greater than 0 ETH.')
  let value: bigint
  try {
    value = parseEther(normalized)
  } catch {
    throw new Error('Enter a valid ETH amount with no more than 18 decimal places.')
  }
  if (value <= 0n) throw new Error('Reward must be greater than 0 ETH.')
  return value
}

export async function submitMarketplaceJob(
  address: string,
  injected: InjectedEthereum,
  targetChainId: bigint,
  reward: bigint,
  inputData: Uint8Array,
): Promise<CreateJobResult> {
  const provider = new BrowserProvider(injected)
  const network = await provider.getNetwork()
  if (network.chainId !== targetChainId) {
    throw new Error(
      `Wrong network: connected to chain ${network.chainId.toString()}, expected ${targetChainId.toString()}.`,
    )
  }

  const signer = await provider.getSigner()
  const contract = new Contract(address, marketplaceAbi as InterfaceAbi, signer)
  const imageId = (await contract.getFunction('approvedImageId')()) as string
  const transaction = await contract.getFunction('createJob')(
    imageId,
    `0x${Array.from(inputData, (byte) => byte.toString(16).padStart(2, '0')).join('')}`,
    { value: reward },
  )
  const receipt = await transaction.wait()
  if (!receipt || receipt.status !== 1) {
    throw new Error('The job creation transaction did not succeed on-chain.')
  }

  let jobId: bigint | null = null
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== address.toLowerCase()) continue
    try {
      const parsedLog = contract.interface.parseLog(log)
      if (parsedLog?.name === 'JobCreated') {
        jobId = parsedLog.args.jobId as bigint
        break
      }
    } catch {
      // Ignore logs that are not emitted by this contract ABI.
    }
  }
  if (jobId === null) {
    throw new Error(
      `The transaction succeeded (${receipt.hash}), but its JobCreated event did not contain a readable job ID.`,
    )
  }

  return { jobId, transactionHash: receipt.hash }
}

export function formatReward(rewardWei: bigint): string {
  const [whole, fraction = ''] = formatEther(rewardWei).split('.')
  const trimmedFraction = fraction.replace(/0+$/, '')
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole
}

export function formatJobCreatedAt(timestamp: bigint): string {
  const seconds = Number(timestamp)
  if (!Number.isSafeInteger(seconds) || seconds < 0) return 'Unknown time'
  const date = new Date(seconds * 1000)
  if (Number.isNaN(date.getTime())) return 'Unknown time'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function toUserMessage(error: unknown): string {
  if (error instanceof Error) {
    if ('code' in error && (error.code === 4001 || error.code === 'ACTION_REJECTED')) {
      return 'The request was rejected in MetaMask.'
    }
    return error.message || 'An unexpected error occurred while communicating with the wallet or marketplace.'
  }
  return 'An unexpected error occurred while communicating with the wallet or marketplace.'
}
