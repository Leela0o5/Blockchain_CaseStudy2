import { BrowserProvider } from 'ethers'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Blocks,
  Check,
  ChevronDown,
  CircleHelp,
  Command,
  Cpu,
  FileCheck2,
  Fingerprint,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Network,
  Plus,
  RefreshCw,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react'
import {
  connectWallet,
  getInjectedEthereum,
  getMarketplaceConfig,
  getMarketplaceSnapshot,
  getRecentJobs,
  getWalletAccount,
  getWalletChainId,
  encodeCanonicalMatrixInputs,
  formatJobCreatedAt,
  formatReward,
  parsePositiveEther,
  shortenAddress,
  submitMarketplaceJob,
  toUserMessage,
  type MarketplaceConfig,
  type MarketplaceJob,
  type MarketplaceSnapshot,
} from './lib/marketplace'
import type { FormEvent, ReactNode } from 'react'
import './App.css'

type LoadState = 'loading' | 'ready' | 'error'
type JobsLoadState = 'idle' | 'loading' | 'ready' | 'error'
type CreateJobState = 'idle' | 'pending' | 'rejected' | 'failed' | 'success'

function App() {
  const config = useMemo(() => getMarketplaceConfig(), [])
  const injectedProvider = useMemo(() => getInjectedEthereum(), [])
  const [account, setAccount] = useState<string | null>(null)
  const [chainId, setChainId] = useState<bigint | null>(null)
  const [snapshot, setSnapshot] = useState<MarketplaceSnapshot | null>(null)
  const [loadState, setLoadState] = useState<LoadState>(injectedProvider ? 'loading' : 'error')
  const [jobs, setJobs] = useState<MarketplaceJob[] | null>(null)
  const [jobsLoadState, setJobsLoadState] = useState<JobsLoadState>('idle')
  const [jobsError, setJobsError] = useState<string | null>(null)
  const [createJobOpen, setCreateJobOpen] = useState(false)
  const [matrixAInput, setMatrixAInput] = useState('')
  const [matrixBInput, setMatrixBInput] = useState('')
  const [rewardInput, setRewardInput] = useState('')
  const [createJobState, setCreateJobState] = useState<CreateJobState>('idle')
  const [createJobMessage, setCreateJobMessage] = useState<string | null>(null)
  const [createdJobId, setCreatedJobId] = useState<bigint | null>(null)
  const [createJobError, setCreateJobError] = useState<string | null>(null)
  const [walletBusy, setWalletBusy] = useState(false)
  const [error, setError] = useState<string | null>(
    injectedProvider ? null : 'No wallet provider was found. Install or enable MetaMask to connect to the marketplace.',
  )
  const [menuOpen, setMenuOpen] = useState(false)
  const jobsRequestId = useRef(0)
  const accountRef = useRef<string | null>(null)

  const refreshJobs = useCallback(async (
    activeConfig: MarketplaceConfig,
    activeAccount: string | null,
    activeChainId: bigint | null,
  ) => {
    const requestId = ++jobsRequestId.current
    if (
      !activeAccount ||
      accountRef.current?.toLowerCase() !== activeAccount.toLowerCase() ||
      !activeConfig.address ||
      activeConfig.chainId === null ||
      activeChainId !== activeConfig.chainId
    ) {
      setJobs(null)
      setJobsError(null)
      setJobsLoadState('idle')
      return
    }

    setJobs(null)
    setJobsError(null)
    setJobsLoadState('loading')
    try {
      const injected = getInjectedEthereum()
      if (!injected) {
        throw new Error('No wallet provider was found. Install or enable MetaMask to read marketplace jobs.')
      }
      const recentJobs = await getRecentJobs(
        activeConfig.address,
        injected,
        activeConfig.chainId,
      )
      if (
        requestId !== jobsRequestId.current ||
        accountRef.current?.toLowerCase() !== activeAccount.toLowerCase()
      ) return
      setJobs(recentJobs)
      setJobsLoadState('ready')
    } catch (cause) {
      if (requestId !== jobsRequestId.current) return
      setJobsError(toUserMessage(cause))
      setJobsLoadState('error')
    }
  }, [])

  const refreshMarketplace = useCallback(async (activeConfig: MarketplaceConfig) => {
    const injected = getInjectedEthereum()
    if (!injected) {
      setLoadState('error')
      setError('No wallet provider was found. Install or enable MetaMask to connect to the marketplace.')
      return
    }

    setLoadState('loading')
    try {
      const nextChainId = await getWalletChainId(injected)
      setChainId(nextChainId)
      if (!activeConfig.address) {
        setSnapshot(null)
        setError(activeConfig.addressError)
        setLoadState('error')
        return
      }
      if (activeConfig.chainId === null) {
        setSnapshot(null)
        setError(activeConfig.chainError)
        setLoadState('error')
        return
      }
      if (nextChainId !== activeConfig.chainId) {
        setSnapshot(null)
        setError(null)
        setLoadState('error')
        return
      }
      const nextSnapshot = await getMarketplaceSnapshot(activeConfig.address, injected)
      setSnapshot(nextSnapshot)
      setError(null)
      setLoadState('ready')
    } catch (cause) {
      setError(toUserMessage(cause))
      setLoadState('error')
    }
  }, [])

  useEffect(() => {
    const injected = injectedProvider
    if (!injected) return

    let active = true
    const updateAccount = (accounts: string[]) => {
      if (!active) return
      jobsRequestId.current += 1
      setJobs(null)
      setJobsError(null)
      setJobsLoadState('idle')
      const nextAccount = accounts[0] ?? null
      accountRef.current = nextAccount
      setAccount(nextAccount)
    }
    const updateChain = (chain: string) => {
      if (!active) return
      try {
        jobsRequestId.current += 1
        setJobs(null)
        setJobsError(null)
        setJobsLoadState('idle')
        setChainId(BigInt(chain))
        void refreshMarketplace(config)
      } catch {
        setError('The wallet returned an invalid chain ID. Check your wallet network and try again.')
        setLoadState('error')
      }
    }

    injected.on('accountsChanged', updateAccount)
    injected.on('chainChanged', updateChain)
    void getWalletAccount(injected).then((activeAccount) => {
      if (active) {
        accountRef.current = activeAccount
        setAccount(activeAccount)
        if (!activeAccount) {
          setJobs(null)
          setJobsLoadState('idle')
        }
      }
    }).catch((cause: unknown) => {
      if (active) {
        setError(toUserMessage(cause))
        setLoadState('error')
      }
    })
    const refreshTimer = window.setTimeout(() => {
      void refreshMarketplace(config)
    }, 0)

    return () => {
      active = false
      window.clearTimeout(refreshTimer)
      injected.removeListener('accountsChanged', updateAccount)
      injected.removeListener('chainChanged', updateChain)
    }
  }, [config, injectedProvider, refreshMarketplace])

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => {
      void refreshJobs(config, account, chainId)
    }, 0)
    return () => window.clearTimeout(refreshTimer)
  }, [account, chainId, config, refreshJobs])

  useEffect(() => {
    if (
      !injectedProvider ||
      !account ||
      !config.address ||
      config.chainId === null ||
      chainId !== config.chainId
    ) {
      return
    }

    const provider = new BrowserProvider(injectedProvider)
    let active = true
    const updateJobs = () => {
      if (active) void refreshJobs(config, account, chainId)
    }
    void provider.on('block', updateJobs).catch((cause: unknown) => {
      if (active) {
        setJobsError(toUserMessage(cause))
        setJobsLoadState('error')
      }
    })

    return () => {
      active = false
      void provider.off('block', updateJobs)
      provider.destroy()
    }
  }, [account, chainId, config, injectedProvider, refreshJobs])

  const handleConnect = async () => {
    const injected = getInjectedEthereum()
    if (!injected) {
      setError('No wallet provider was found. Install or enable MetaMask to connect.')
      return
    }

    setWalletBusy(true)
    setError(null)
    try {
      const connectedAccount = await connectWallet(injected)
      accountRef.current = connectedAccount
      setAccount(connectedAccount)
      await refreshMarketplace(config)
    } catch (cause) {
      setError(toUserMessage(cause))
    } finally {
      setWalletBusy(false)
    }
  }

  const handleDisconnect = () => {
    jobsRequestId.current += 1
    setJobs(null)
    setJobsError(null)
    setJobsLoadState('idle')
    accountRef.current = null
    setAccount(null)
  }

  const canSubmitJob = Boolean(
    account &&
    config.address &&
    config.chainId !== null &&
    chainId === config.chainId &&
    createJobState !== 'pending',
  )

  const openCreateJob = () => {
    setCreateJobOpen(true)
    setCreateJobState('idle')
    setCreateJobMessage(null)
    setCreatedJobId(null)
    setCreateJobError(null)
  }

  const closeCreateJob = () => {
    if (createJobState === 'pending') return
    setCreateJobOpen(false)
  }

  const handleCreateJob = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCreateJobError(null)
    setCreateJobMessage(null)
    setCreatedJobId(null)

    let inputData: Uint8Array
    let reward: bigint
    try {
      inputData = encodeCanonicalMatrixInputs(matrixAInput, matrixBInput)
      reward = parsePositiveEther(rewardInput)
    } catch (cause) {
      setCreateJobError(toUserMessage(cause))
      setCreateJobState('idle')
      return
    }

    const injected = getInjectedEthereum()
    if (!account || !injected || !config.address || config.chainId === null || chainId !== config.chainId) {
      setCreateJobError('Connect a wallet on the configured marketplace network before submitting.')
      return
    }

    setCreateJobState('pending')
    setCreateJobMessage('Confirm the transaction in your wallet. The job will be listed after it is mined.')
    try {
      const result = await submitMarketplaceJob(
        config.address,
        injected,
        config.chainId,
        reward,
        inputData,
      )
      setCreatedJobId(result.jobId)
      setCreateJobState('success')
      setCreateJobMessage(`Job #${result.jobId.toString()} was created successfully. Transaction: ${result.transactionHash}`)
      await refreshMarketplace(config)
      await refreshJobs(config, account, config.chainId)
    } catch (cause) {
      const rejected = typeof cause === 'object' && cause !== null && 'code' in cause &&
        (cause.code === 4001 || cause.code === 'ACTION_REJECTED')
      setCreateJobState(rejected ? 'rejected' : 'failed')
      setCreateJobMessage(
        rejected
          ? 'Transaction request rejected in MetaMask. No job was created.'
          : toUserMessage(cause),
      )
    }
  }

  const isChainMismatch =
    chainId !== null && config.chainId !== null && chainId !== config.chainId

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><Blocks size={20} strokeWidth={2.2} /></div>
          <div className="brand-copy">
            <span className="brand-name">compute<span>layer</span></span>
            <span className="brand-caption">DECENTRALIZED COMPUTE</span>
          </div>
          <button className="icon-button close-menu" type="button" aria-label="Close menu" onClick={() => setMenuOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <div className="workspace-picker">
          <div className="workspace-icon"><Cpu size={17} /></div>
          <div className="workspace-copy"><strong>Matrix Network</strong><span>Marketplace workspace</span></div>
          <ChevronDown className="workspace-chevron" size={15} />
        </div>

        <nav className="primary-nav" aria-label="Main navigation">
          <span className="nav-label">WORKSPACE</span>
          <a className="nav-link nav-link-active" href="#overview" aria-current="page">
            <LayoutDashboard size={17} /><span>Overview</span>
          </a>
          <a className="nav-link nav-link-disabled" href="#jobs" aria-disabled="true" onClick={(event) => event.preventDefault()}>
            <FileCheck2 size={17} /><span>Jobs</span><span className="nav-soon">SOON</span>
          </a>
          <a className="nav-link nav-link-disabled" href="#workers" aria-disabled="true" onClick={(event) => event.preventDefault()}>
            <Activity size={17} /><span>Workers</span><span className="nav-soon">SOON</span>
          </a>
        </nav>

        <div className="sidebar-spacer" />

        <div className="network-card">
          <div className="network-card-top">
            <span className={`network-dot ${loadState === 'ready' ? 'dot-online' : ''}`} />
            <span>NETWORK STATUS</span>
            <span className="network-card-state">{loadState === 'ready' ? 'LIVE' : '—'}</span>
          </div>
          <div className="network-card-name"><Network size={15} /> {chainId ? `Chain ${chainId}` : 'Waiting for wallet'}</div>
          <div className="network-card-foot"><span>Marketplace</span><span>{loadState === 'ready' ? 'Connected' : 'Not connected'}</span></div>
        </div>

        <div className="sidebar-footer">
          <div className="avatar avatar-purple">CL</div>
          <div className="footer-user"><strong>ComputeLayer</strong><span>Protocol dashboard</span></div>
          <button className="icon-button help-button" type="button" aria-label="Help"><CircleHelp size={17} /></button>
        </div>
      </aside>

      {menuOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}

      <main className="main-content" id="overview">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button menu-toggle" type="button" aria-label="Open menu" onClick={() => setMenuOpen(true)}>
              <Menu size={20} />
            </button>
            <div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>Overview</strong></div>
          </div>
          <div className="topbar-actions">
            <div className={`wallet-status ${account ? 'wallet-connected' : ''}`}>
              <span className="wallet-indicator" />
              <span>{account ? 'Wallet connected' : 'Wallet not connected'}</span>
            </div>
            {account ? (
              <div className="account-menu">
                <div className="account-chip"><span className="avatar avatar-wallet"><Wallet size={15} /></span><span>{shortenAddress(account)}</span><Check size={14} className="account-check" /></div>
                <button className="icon-button disconnect-button" type="button" aria-label="Disconnect wallet session" title="Disconnect wallet session" onClick={handleDisconnect}>
                  <LogOut size={16} />
                </button>
              </div>
            ) : (
              <button className="button button-primary connect-button" type="button" onClick={() => void handleConnect()} disabled={walletBusy}>
                {walletBusy ? <LoaderCircle className="spin" size={16} /> : <Wallet size={16} />}
                {walletBusy ? 'Connecting…' : 'Connect wallet'}
              </button>
            )}
          </div>
        </header>

        <div className="page-container">
          {isChainMismatch && (
            <div className="notice notice-warning" role="status">
              <div className="notice-icon"><Network size={17} /></div>
              <div><strong>Wrong network</strong><span>Your wallet is on chain {chainId?.toString()}, but this app is configured for chain {config.chainId?.toString()}. Switch networks in MetaMask to interact with the configured marketplace.</span></div>
            </div>
          )}

          {(config.addressError || config.chainError) && (
            <div className="notice notice-config" role="alert">
              <div className="notice-icon"><CircleHelp size={17} /></div>
              <div><strong>Configuration needed</strong><span>{[config.addressError, config.chainError].filter(Boolean).join(' ')}</span></div>
            </div>
          )}

          {error && (
            <div className="notice notice-error" role="alert">
              <div className="notice-icon"><CircleHelp size={17} /></div>
              <div><strong>Unable to load marketplace</strong><span>{error}</span></div>
              <button className="icon-button notice-dismiss" type="button" aria-label="Dismiss error" onClick={() => setError(null)}><X size={16} /></button>
            </div>
          )}

          <section className="welcome-row">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> PROTOCOL OVERVIEW</div>
              <h1>Your compute layer,<br className="mobile-break" /> <span>at a glance.</span></h1>
              <p className="welcome-copy">A live view into your decentralized compute marketplace.</p>
            </div>
            <div className="welcome-art" aria-hidden="true">
              <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
              <div className="art-core"><Command size={28} /></div>
              <span className="art-node node-a"><ShieldCheck size={14} /></span>
              <span className="art-node node-b"><Cpu size={14} /></span>
              <span className="art-node node-c"><Fingerprint size={14} /></span>
            </div>
          </section>

          <section className="metrics-grid" aria-label="Marketplace summary">
            <MetricCard
              eyebrow="MARKETPLACE CONNECTION"
              title={loadState === 'loading' ? 'Connecting…' : loadState === 'ready' ? 'Connected' : 'Unavailable'}
              detail={config.address ? shortenAddress(config.address) : 'Address not configured'}
              icon={<Network size={18} />}
              tone="green"
              loading={loadState === 'loading'}
              badge={loadState === 'ready' ? 'ONLINE' : undefined}
            >
              <div className="metric-bottom"><span>Wallet network</span><strong>{chainId === null ? 'Not detected' : `Chain ${chainId.toString()}`}</strong></div>
            </MetricCard>

            <MetricCard
              eyebrow="APPROVED GUEST IMAGE"
              title={snapshot?.approvedImageId ? `${snapshot.approvedImageId.slice(0, 10)}…${snapshot.approvedImageId.slice(-6)}` : '—'}
              detail={snapshot?.approvedImageId ? 'Verified matrix program' : 'Awaiting contract data'}
              icon={<Fingerprint size={18} />}
              tone="violet"
              loading={loadState === 'loading'}
            >
              <div className="metric-bottom"><span>Approval policy</span><strong><ShieldCheck size={13} /> Immutable</strong></div>
            </MetricCard>

            <MetricCard
              eyebrow="NEXT JOB ID"
              title={snapshot?.nextJobId !== undefined ? snapshot.nextJobId.toString() : '—'}
              detail={snapshot?.nextJobId !== undefined ? 'Ready for the next request' : 'Awaiting contract data'}
              icon={<Blocks size={18} />}
              tone="blue"
              loading={loadState === 'loading'}
            >
              <div className="metric-bottom"><span>Chain ID</span><strong>{chainId === null ? '—' : chainId.toString()}</strong></div>
            </MetricCard>
          </section>

          <section className="content-grid">
            <div className="panel activity-panel">
              <div className="panel-heading">
                <div><div className="panel-kicker">MARKETPLACE</div><h2>Job activity</h2></div>
                <div className="activity-actions">
                  <button
                    className="button button-muted refresh-jobs"
                    type="button"
                    disabled={!account || isChainMismatch || jobsLoadState === 'loading'}
                    onClick={() => void refreshJobs(config, account, chainId)}
                  >
                    <RefreshCw size={13} className={jobsLoadState === 'loading' ? 'spin' : ''} />
                    Refresh
                  </button>
                  <button className="button button-primary new-job-button" type="button" onClick={openCreateJob} disabled={createJobState === 'pending'}>
                    <Plus size={15} /> New job
                  </button>
                </div>
              </div>
              {!injectedProvider ? (
                <JobsMessage icon={<CircleHelp size={19} />} title="Wallet provider unavailable" message="Install or enable MetaMask to read marketplace jobs." />
              ) : config.addressError || config.chainError ? (
                <JobsMessage icon={<CircleHelp size={19} />} title="Marketplace not configured" message="Set a valid marketplace address and target chain in the frontend environment." />
              ) : !account ? (
                <JobsMessage icon={<Wallet size={19} />} title="Connect your wallet" message="Connect a wallet to load recent jobs from the configured marketplace." />
              ) : isChainMismatch ? (
                <JobsMessage icon={<Network size={19} />} title="Switch to the target network" message="Job data is hidden until the wallet is connected to the configured marketplace network." />
              ) : jobsLoadState === 'loading' ? (
                <JobsMessage loading title="Loading recent jobs" message="Reading the newest marketplace jobs from the configured network." />
              ) : jobsLoadState === 'error' ? (
                <JobsMessage alert icon={<CircleHelp size={19} />} title="Unable to load jobs" message={jobsError ?? 'The marketplace returned an unexpected error while reading jobs.'} />
              ) : jobs && jobs.length > 0 ? (
                <div className="job-table-wrap">
                  <table className="job-table">
                    <thead>
                      <tr>
                        <th>Job</th><th>Status</th><th>Requester</th><th>Worker</th><th>Reward</th><th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((job) => (
                        <tr key={job.id.toString()}>
                          <td className="job-id">#{job.id.toString()}</td>
                          <td><span className={`job-status status-${job.status.toLowerCase()}`}>{job.status}</span></td>
                          <td className="job-address" title={job.requester}>{shortenAddress(job.requester)}</td>
                          <td className="job-address" title={job.worker}>
                            {job.worker.toLowerCase() === '0x0000000000000000000000000000000000000000'
                              ? 'Unassigned'
                              : shortenAddress(job.worker)}
                          </td>
                          <td className="job-reward">{formatReward(job.reward)} ETH</td>
                          <td className="job-date">{formatJobCreatedAt(job.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-illustration">
                    <div className="empty-orbit empty-orbit-outer" /><div className="empty-orbit empty-orbit-inner" />
                    <div className="empty-icon"><Blocks size={23} /></div>
                    <span className="empty-spark spark-one" /><span className="empty-spark spark-two" /><span className="empty-spark spark-three" />
                  </div>
                  <h3>No jobs found</h3>
                  <p>There are no jobs yet in the configured marketplace.</p>
                  <span className="empty-note"><ShieldCheck size={14} /> Proof verification is handled on-chain</span>
                </div>
              )}
              <div className="panel-bottom-note"><span><Activity size={14} /> Recent marketplace jobs</span><span>Newest first · maximum 10</span></div>
            </div>

            <aside className="panel network-panel">
              <div className="panel-heading panel-heading-compact">
                <div><div className="panel-kicker">CONNECTION</div><h2>Network details</h2></div>
                <div className="network-icon"><Network size={16} /></div>
              </div>
              <div className="network-details">
                <DetailRow label="Marketplace" value={config.address ? shortenAddress(config.address) : 'Not configured'} mono />
                <DetailRow label="Current chain" value={chainId === null ? 'Not detected' : chainId.toString()} />
                <DetailRow label="Target chain" value={config.chainId === null ? 'Not configured' : config.chainId.toString()} />
                <DetailRow label="Wallet account" value={account ? shortenAddress(account) : 'Disconnected'} mono />
              </div>
              <div className={`connection-callout ${isChainMismatch ? 'callout-warning' : ''}`}>
                <span className="callout-dot" />
                <span>{isChainMismatch ? 'Wallet network does not match target' : loadState === 'ready' ? 'Read-only contract connection active' : 'Waiting for marketplace connection'}</span>
              </div>
            </aside>
          </section>

          <footer className="page-footer">
            <span>ComputeLayer <span className="footer-separator">·</span> Decentralized compute, verifiable by design.</span>
            <span className="footer-links"><span><ArrowDownLeft size={12} /> READ-ONLY DASHBOARD</span><span><ArrowUpRight size={12} /> RISC ZERO VERIFIED</span></span>
          </footer>
        </div>
        {createJobOpen && (
          <div
            className="job-form-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeCreateJob()
            }}
          >
            <section className="job-form-dialog" role="dialog" aria-modal="true" aria-labelledby="create-job-title">
              <div className="job-form-heading">
                <div>
                  <div className="panel-kicker">NEW COMPUTE REQUEST</div>
                  <h2 id="create-job-title">Create matrix job</h2>
                </div>
                <button className="icon-button" type="button" aria-label="Close job form" onClick={closeCreateJob} disabled={createJobState === 'pending'}>
                  <X size={17} />
                </button>
              </div>
              <p className="job-form-description">
                Enter integer matrices as comma-separated rows. The reward is escrowed by the contract when the transaction is confirmed.
              </p>
              <form className="job-form" onSubmit={(event) => void handleCreateJob(event)}>
                <label>
                  Matrix A
                  <textarea
                    value={matrixAInput}
                    onChange={(event) => setMatrixAInput(event.target.value)}
                    placeholder={'1, 2, 3\n4, 5, 6'}
                    rows={3}
                    required
                    disabled={createJobState === 'pending'}
                    spellCheck={false}
                  />
                </label>
                <label>
                  Matrix B
                  <textarea
                    value={matrixBInput}
                    onChange={(event) => setMatrixBInput(event.target.value)}
                    placeholder={'7, 8\n9, 10\n11, 12'}
                    rows={3}
                    required
                    disabled={createJobState === 'pending'}
                    spellCheck={false}
                  />
                </label>
                <p className="matrix-input-hint">Each row must have the same number of values. Matrix A columns must match Matrix B rows. Values must fit signed 32-bit integers.</p>
                <label>
                  Reward (ETH)
                  <input
                    inputMode="decimal"
                    type="text"
                    value={rewardInput}
                    onChange={(event) => setRewardInput(event.target.value)}
                    placeholder="0.01"
                    required
                    disabled={createJobState === 'pending'}
                    autoComplete="off"
                  />
                </label>

                {!canSubmitJob && createJobState !== 'pending' && (
                  <p className="job-form-guard" role="status">
                    {!account
                      ? 'Connect your wallet to submit this job.'
                      : isChainMismatch
                        ? `Switch to chain ${config.chainId?.toString() ?? 'configured by the app'} to submit.`
                        : 'The configured marketplace is not ready for submissions.'}
                  </p>
                )}
                {createJobError && <p className="job-form-feedback feedback-error" role="alert">{createJobError}</p>}
                {createJobMessage && (
                  <p className={`job-form-feedback feedback-${createJobState}`} role={createJobState === 'failed' || createJobState === 'rejected' ? 'alert' : 'status'}>
                    {createJobState === 'pending' && <LoaderCircle size={15} className="spin" />}
                    {createJobState === 'success' && <Check size={15} />}
                    {createJobMessage}
                  </p>
                )}
                {createdJobId !== null && <p className="created-job-id">Created job #{createdJobId.toString()}</p>}
                <div className="job-form-actions">
                  <button className="button button-muted" type="button" onClick={closeCreateJob} disabled={createJobState === 'pending'}>Cancel</button>
                  <button className="button button-primary" type="submit" disabled={!canSubmitJob}>
                    {createJobState === 'pending'
                      ? <><LoaderCircle size={15} className="spin" /> Transaction pending…</>
                      : createJobState === 'success'
                        ? 'Create another job'
                        : <><Plus size={15} /> Create job</>}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
      </main>
    </div>
  )
}

interface MetricCardProps {
  eyebrow: string
  title: string
  detail: string
  icon: ReactNode
  tone: 'green' | 'violet' | 'blue'
  loading: boolean
  badge?: string
  children: ReactNode
}

function MetricCard({ eyebrow, title, detail, icon, tone, loading, badge, children }: MetricCardProps) {
  return (
    <article className="metric-card">
      <div className={`metric-icon metric-icon-${tone}`}>{icon}</div>
      {badge && <span className="metric-badge"><span />{badge}</span>}
      <div className="metric-eyebrow">{eyebrow}</div>
      <div className={`metric-value ${title.startsWith('0x') ? 'metric-hash' : ''}`}>
        {loading ? <LoaderCircle className="spin metric-loader" size={20} /> : title}
      </div>
      <div className="metric-detail">{detail}</div>
      <div className="metric-separator" />
      {children}
    </article>
  )
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="detail-row"><span>{label}</span><strong className={mono ? 'mono-value' : ''}>{value}</strong></div>
}

function JobsMessage({
  icon,
  title,
  message,
  loading = false,
  alert = false,
}: {
  icon?: ReactNode
  title: string
  message: string
  loading?: boolean
  alert?: boolean
}) {
  return (
    <div className={`jobs-message ${loading ? 'jobs-message-loading' : ''}`} role={alert ? 'alert' : 'status'}>
      <div className="jobs-message-icon">
        {loading ? <LoaderCircle size={19} className="spin" /> : icon}
      </div>
      <div><h3>{title}</h3><p>{message}</p></div>
    </div>
  )
}

export default App
