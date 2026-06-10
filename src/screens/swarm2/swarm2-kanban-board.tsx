'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { HugeiconsIcon } from '@hugeicons/react'
import { PlusSignIcon, Archive02Icon, Office01Icon } from '@hugeicons/core-free-icons'

type KanbanLane = 'backlog' | 'ready' | 'running' | 'review' | 'blocked' | 'done'

type SwarmKanbanCard = {
  id: string
  title: string
  spec: string
  acceptanceCriteria: Array<string>
  assignedWorker: string | null
  reviewer: string | null
  status: KanbanLane
  missionId: string | null
  reportPath: string | null
  createdBy: string
  createdAt: number
  updatedAt: number
  tags?: Array<string>
  latestRun?: {
    summary?: string | null
    outcome?: string | null
    status?: string | null
  } | null
}

type KanbanWorker = {
  id: string
  displayName?: string | null
  role?: string | null
}

type KanbanBackendMeta = {
  id: 'local' | 'claude' | 'hermes-proxy'
  label: string
  detected: boolean
  writable: boolean
  details?: string | null
  path?: string | null
}

type KanbanBoardMeta = {
  slug: string
  displayName?: string | null
  description?: string | null
  icon?: string | null
  archived?: boolean
}

type KanbanResponse = {
  cards?: Array<SwarmKanbanCard>
  backend?: KanbanBackendMeta
}

type Swarm2KanbanBoardProps = {
  workers: Array<KanbanWorker>
  latestMission?: { id: string; title: string; state: string } | null
  selectedWorkerId?: string | null
  onSelectWorker?: (workerId: string) => void
  onOpenRouter?: () => void
  className?: string
}

type KanbanBackendPresentation = {
  badgeLabel: string
  badgeTone: 'hermes-proxy' | 'claude' | 'local' | 'unknown'
  toastTitle: string
  toastBody: string
  title: string | undefined
  /** When set, the badge becomes a deep-link to a dashboard that is safe/reachable from the current browser. */
  dashboardUrl?: string
}

function isLoopbackDashboardUrl(value: string | null | undefined): boolean {
  if (!value) return false
  try {
    const url = new URL(value)
    return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
  } catch {
    return false
  }
}

export function getKanbanBackendPresentation(backend: KanbanBackendMeta | null | undefined): KanbanBackendPresentation {
  if (!backend) {
    return {
      badgeLabel: 'Detecting board',
      badgeTone: 'unknown',
      toastTitle: 'Detecting Swarm Board backend',
      toastBody: 'Checking Hermes Kanban before falling back locally.',
      title: undefined,
    }
  }
  if (backend.id === 'hermes-proxy' && backend.detected) {
    const dashboardUrl =
      typeof backend.path === 'string' &&
      backend.path.startsWith('http') &&
      !isLoopbackDashboardUrl(backend.path)
        ? `${backend.path.replace(/\/+$/, '')}/kanban`
        : undefined
    return {
      badgeLabel: 'Synced • Hermes',
      badgeTone: 'hermes-proxy',
      toastTitle: 'Synced with Hermes Dashboard',
      toastBody:
        'Cards and status changes round-trip through the Hermes Dashboard kanban plugin. Single source of truth, dispatcher-aware.',
      title:
        backend.details ??
        backend.path ??
        'Hermes Dashboard kanban plugin detected',
      dashboardUrl,
    }
  }
  if (backend.id === 'claude' && backend.detected) {
    return {
      badgeLabel: 'Shared board',
      badgeTone: 'claude',
      toastTitle: 'Board connected',
      toastBody: 'Cards and status changes are using the canonical Kanban store.',
      title: backend.details ?? backend.path ?? 'Canonical Kanban store detected',
    }
  }
  return {
    badgeLabel: 'Local fallback',
    badgeTone: 'local',
    toastTitle: 'Using local Swarm Board',
    toastBody: backend.details || 'Hermes Kanban is not available yet. Cards stay local and the board will switch automatically when Hermes storage is detected.',
    title: backend.details ?? backend.path ?? 'Local Swarm Board fallback',
  }
}

const LANES: Array<{ id: KanbanLane; label: string; hint: string }> = [
  { id: 'backlog', label: 'Backlog', hint: 'Captured, not committed' },
  { id: 'ready', label: 'Ready', hint: 'Spec clear, safe to dispatch' },
  { id: 'running', label: 'Running', hint: 'Worker executing' },
  { id: 'review', label: 'Review', hint: 'Needs peer/human check' },
  { id: 'blocked', label: 'Blocked', hint: 'Needs input or dependency' },
  { id: 'done', label: 'Done', hint: 'Accepted / archived' },
]

const LANE_TONE: Record<KanbanLane, string> = {
  backlog: 'border-slate-400/40 bg-slate-500/10 text-slate-700',
  ready: 'border-blue-400/40 bg-blue-500/10 text-blue-700',
  running: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700',
  review: 'border-violet-400/40 bg-violet-500/10 text-violet-700',
  blocked: 'border-red-400/40 bg-red-500/10 text-red-700',
  done: 'border-green-400/40 bg-green-500/10 text-green-700',
}

async function fetchKanbanCards(board?: string): Promise<{ cards: Array<SwarmKanbanCard>; backend: KanbanBackendMeta | null }> {
  const url = board ? `/api/swarm-kanban?board=${encodeURIComponent(board)}` : '/api/swarm-kanban'
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Kanban request failed: ${res.status}`)
  const data = (await res.json()) as KanbanResponse
  return {
    cards: Array.isArray(data.cards) ? data.cards : [],
    backend: data.backend ?? null,
  }
}

async function fetchKanbanBoards(): Promise<{ boards: KanbanBoardMeta[], current: string }> {
  const res = await fetch('/api/swarm-kanban?action=boards')
  if (!res.ok) throw new Error(`Boards request failed: ${res.status}`)
  return res.json()
}

async function createKanbanCard(input: {
  title: string
  spec: string
  acceptanceCriteria: Array<string>
  assignedWorker: string | null
  reviewer: string | null
  status: KanbanLane
  missionId: string | null
  tags: Array<string>
}, board?: string): Promise<SwarmKanbanCard> {
  const url = board ? `/api/swarm-kanban?board=${encodeURIComponent(board)}` : '/api/swarm-kanban'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.ok === false) throw new Error(data?.error || `Kanban create failed: ${res.status}`)
  return data.card
}

async function updateKanbanCard(id: string, updates: Partial<SwarmKanbanCard>, board?: string): Promise<SwarmKanbanCard> {
  const url = board ? `/api/swarm-kanban?board=${encodeURIComponent(board)}` : '/api/swarm-kanban'
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...updates }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.ok === false) throw new Error(data?.error || `Kanban update failed: ${res.status}`)
  return data.card
}

async function createBoard(input: { slug: string; name?: string; description?: string; icon?: string }): Promise<KanbanBoardMeta> {
  const res = await fetch('/api/swarm-kanban?action=boards', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await res.json()
  if (!res.ok || data?.ok === false) throw new Error(data?.error || 'Board creation failed')
  return data.board
}

async function archiveBoard(slug: string): Promise<void> {
  const res = await fetch(`/api/swarm-kanban?action=boards&slug=${encodeURIComponent(slug)}`, {
    method: 'DELETE'
  })
  if (!res.ok) throw new Error('Board archival failed')
}

function splitCriteria(value: string): Array<string> {
  return value
    .split('\n')
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
}

function splitTags(value: string): Array<string> {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function workerLabel(workers: Array<KanbanWorker>, id: string | null | undefined): string {
  if (!id) return 'Unassigned'
  const worker = workers.find((w) => w.id === id)
  return worker?.displayName || worker?.id || id
}

function parseTaskLabel(label: string): { tier1: string; tier2?: string; color: string } | null {
  if (!label.toLowerCase().startsWith('label:')) return null
  const [tier1, tier2] = label.slice(6).split('/')
  const hash = Array.from(tier1).reduce((acc, char) => acc + char.charCodeAt(0), 0)
  const COLORS = [
    'border-blue-400/40 bg-blue-500/10 text-blue-700',
    'border-emerald-400/40 bg-emerald-500/10 text-emerald-700',
    'border-violet-400/40 bg-violet-500/10 text-violet-700',
    'border-orange-400/40 bg-orange-500/10 text-orange-700',
    'border-cyan-400/40 bg-cyan-500/10 text-cyan-700',
    'border-rose-400/40 bg-rose-500/10 text-rose-700',
  ]
  return { tier1, tier2, color: COLORS[hash % COLORS.length] }
}

function formatElapsedSince(timestamp: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`
  const elapsedMinutes = Math.floor(elapsedSeconds / 60)
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return `${elapsedHours}h`
  return `${Math.floor(elapsedHours / 24)}d`
}

export function Swarm2KanbanBoard({
  workers,
  latestMission,
  selectedWorkerId,
  onSelectWorker,
  onOpenRouter,
  className,
}: Swarm2KanbanBoardProps) {
  const queryClient = useQueryClient()
  const [selectedBoard, setSelectedBoard] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('hermes_kanban_selected_board') || 'default'
    }
    return 'default'
  })

  useEffect(() => {
    localStorage.setItem('hermes_kanban_selected_board', selectedBoard)
  }, [selectedBoard])

  const boardsQuery = useQuery({
    queryKey: ['kanban-boards'],
    queryFn: fetchKanbanBoards,
  })

  const query = useQuery({
    queryKey: ['swarm-kanban', selectedBoard],
    queryFn: () => fetchKanbanCards(selectedBoard),
    refetchInterval: 30_000,
  })

  const [composerOpen, setComposerOpen] = useState(false)
  const [boardModalOpen, setBoardModalOpen] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftSpec, setDraftSpec] = useState('')
  const [draftCriteria, setDraftCriteria] = useState('')
  const [draftLabels, setDraftLabels] = useState('')
  const [draftWorkerId, setDraftWorkerId] = useState('')
  const [draftStatus, setDraftStatus] = useState<KanbanLane>('backlog')
  const [linkLatestMission, setLinkLatestMission] = useState(true)

  const [newBoardSlug, setNewBoardSlug] = useState('')
  const [newBoardName, setNewBoardName] = useState('')
  const [newBoardDesc, setNewBoardDesc] = useState('')
  const [newBoardIcon, setNewBoardIcon] = useState('')

  const createMutation = useMutation({
    mutationFn: (input: {
      title: string
      spec: string
      acceptanceCriteria: Array<string>
      assignedWorker: string | null
      reviewer: string | null
      status: KanbanLane
      missionId: string | null
      tags: Array<string>
    }) => createKanbanCard(input, selectedBoard),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['swarm-kanban', selectedBoard] })
      setComposerOpen(false)
      setDraftTitle('')
      setDraftSpec('')
      setDraftCriteria('')
      setDraftLabels('')
      setDraftWorkerId('')
      setDraftStatus('backlog')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<SwarmKanbanCard> }) =>
      updateKanbanCard(id, updates, selectedBoard),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['swarm-kanban', selectedBoard] })
    },
  })

  const createBoardMutation = useMutation({
    mutationFn: createBoard,
    onSuccess: (board) => {
      void queryClient.invalidateQueries({ queryKey: ['kanban-boards'] })
      setSelectedBoard(board.slug)
      setBoardModalOpen(false)
      setNewBoardSlug('')
      setNewBoardName('')
      setNewBoardDesc('')
      setNewBoardIcon('')
    }
  })

  const archiveBoardMutation = useMutation({
    mutationFn: archiveBoard,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kanban-boards'] })
      setSelectedBoard('default')
    }
  })

  const cardsByLane = useMemo(() => {
    const map = new Map<KanbanLane, Array<SwarmKanbanCard>>()
    for (const card of query.data?.cards ?? []) {
      const list = map.get(card.status) ?? []
      list.push(card)
      map.set(card.status, list)
    }
    return map
  }, [query.data])

  const backend = query.data?.backend
  const presentation = getKanbanBackendPresentation(backend)

  const handleCreateCard = () => {
    void createMutation.mutateAsync({
      title: draftTitle,
      spec: draftSpec,
      acceptanceCriteria: splitCriteria(draftCriteria),
      assignedWorker: draftWorkerId || null,
      reviewer: null,
      status: draftStatus,
      missionId: linkLatestMission && latestMission ? latestMission.id : null,
      tags: splitTags(draftLabels),
    })
  }

  const boards = boardsQuery.data?.boards ?? []
  const activeBoard = boards.find(b => b.slug === selectedBoard)
  const hasMultipleBoards = boards.length > 1 || query.data?.cards?.length

  return (
    <section className={cn('flex flex-col gap-4', className)}>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold tracking-tight text-[var(--theme-text)]">Kanban</h2>

          <div className="flex items-center gap-2">
            <div className="relative">
              <select
                value={selectedBoard}
                onChange={(e) => setSelectedBoard(e.target.value)}
                className="appearance-none rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] pl-10 pr-10 py-1.5 text-sm font-semibold text-[var(--theme-text)] outline-none hover:bg-[var(--theme-card2)] transition-colors"
              >
                {boards.map(b => (
                  <option key={b.slug} value={b.slug}>{b.icon ? `${b.icon} ` : ''}{b.displayName || b.slug}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--theme-muted)]">
                <HugeiconsIcon icon={Office01Icon} size={16} />
              </div>
            </div>

            <button
              onClick={() => setBoardModalOpen(true)}
              className="flex size-8 items-center justify-center rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-muted)] hover:bg-[var(--theme-card2)] hover:text-[var(--theme-text)] transition-colors"
              title="New board"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={16} />
            </button>
            {selectedBoard !== 'default' && (
              <button
                onClick={() => {
                  if (confirm(`Archive board "${selectedBoard}"?`)) {
                    void archiveBoardMutation.mutateAsync(selectedBoard)
                  }
                }}
                className="flex size-8 items-center justify-center rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] text-[var(--theme-muted)] hover:bg-[var(--theme-card2)] hover:text-red-500 transition-colors"
                title="Archive board"
              >
                <HugeiconsIcon icon={Archive02Icon} size={16} />
              </button>
            )}
          </div>

          <div className={cn('rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider shadow-sm transition-colors', presentation.badgeTone === 'hermes-proxy' ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-700' : presentation.badgeTone === 'claude' ? 'border-blue-400/40 bg-blue-500/10 text-blue-700' : 'border-slate-400/40 bg-slate-500/10 text-slate-700')} title={presentation.title}>
            {presentation.dashboardUrl ? (
              <a href={presentation.dashboardUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{presentation.badgeLabel}</a>
            ) : presentation.badgeLabel}
          </div>

          {activeBoard?.description && (
            <span className="hidden text-xs text-[var(--theme-muted)] lg:inline-block">— {activeBoard.description}</span>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setComposerOpen(!composerOpen)} className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-2 text-sm font-semibold text-[var(--theme-text)] shadow-sm hover:bg-[var(--theme-card2)] transition-colors">
            {composerOpen ? 'Cancel' : 'Add card'}
          </button>
        </div>
      </header>

      {boardModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-6 shadow-2xl">
            <div className="mb-4 flex items-center gap-2">
              <HugeiconsIcon icon={Office01Icon} size={20} className="text-[var(--theme-accent)]" />
              <h3 className="text-lg font-bold text-[var(--theme-text)]">Create New Project Board</h3>
            </div>
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-[var(--theme-muted)] uppercase tracking-wider">Board Slug (immutable)</span>
                <input
                  value={newBoardSlug}
                  onChange={e => setNewBoardSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'))}
                  placeholder="my-company-project"
                  className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-[var(--theme-muted)] uppercase tracking-wider">Display Name</span>
                <input
                  value={newBoardName}
                  onChange={e => setNewBoardName(e.target.value)}
                  placeholder="ACME Corp - Web App"
                  className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-[var(--theme-muted)] uppercase tracking-wider">Description (optional)</span>
                <textarea
                  value={newBoardDesc}
                  onChange={e => setNewBoardDesc(e.target.value)}
                  rows={2}
                  placeholder="Company/Firm context for this project view..."
                  className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-[var(--theme-muted)] uppercase tracking-wider">Icon / Avatar</span>
                <input
                  value={newBoardIcon}
                  onChange={e => setNewBoardIcon(e.target.value)}
                  placeholder="🏢"
                  className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none"
                />
              </label>
              <div className="mt-2 rounded-lg bg-[var(--theme-bg)] p-3 text-[10px] text-[var(--theme-muted)]">
                <p>Initializing a new board will automatically run <strong>firm init</strong> in the project folder to track company/firm metadata.</p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setBoardModalOpen(false)}
                  className="rounded-xl border border-[var(--theme-border)] px-4 py-2 text-sm font-semibold text-[var(--theme-muted)] hover:bg-[var(--theme-card2)]"
                >
                  Cancel
                </button>
                <button
                  disabled={!newBoardSlug || createBoardMutation.isPending}
                  onClick={() => void createBoardMutation.mutateAsync({ slug: newBoardSlug, name: newBoardName, description: newBoardDesc, icon: newBoardIcon })}
                  className="rounded-xl bg-[var(--theme-accent)] px-4 py-2 text-sm font-semibold text-primary-950 disabled:opacity-50"
                >
                  {createBoardMutation.isPending ? 'Initializing...' : 'Create Project'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {composerOpen ? (
        <div className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-4 shadow-sm">
          <div className="space-y-4">
            <input autoFocus value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="Card title…" className="w-full bg-transparent text-lg font-semibold text-[var(--theme-text)] outline-none" onKeyDown={(event) => { if (event.key === 'Enter' && draftTitle.trim() && !createMutation.isPending) void handleCreateCard() }} />
            <textarea value={draftSpec} onChange={(event) => setDraftSpec(event.target.value)} placeholder="Requirement or spec summary…" className="min-h-24 w-full resize-none bg-transparent text-sm text-[var(--theme-text)] outline-none" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="block text-xs">
                <span className="mb-1 block font-semibold text-[var(--theme-muted)]">Acceptance criteria (one per line)</span>
                <textarea value={draftCriteria} onChange={(event) => setDraftCriteria(event.target.value)} placeholder="- Criterion 1\n- Criterion 2" className="min-h-20 w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none" />
              </label>
              <label className="block text-xs">
                <span className="mb-1 block font-semibold text-[var(--theme-muted)]">Assignee</span>
                <select value={draftWorkerId} onChange={(event) => setDraftWorkerId(event.target.value)} className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none">
                  <option value="">Unassigned</option>
                  {workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.displayName || worker.id}</option>)}
                </select>
              </label>
              <label className="block text-xs">
                <span className="mb-1 block font-semibold text-[var(--theme-muted)]">Status</span>
                <select value={draftStatus} onChange={(event) => setDraftStatus(event.target.value as KanbanLane)} className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none">
                  {LANES.map((lane) => <option key={lane.id} value={lane.id}>{lane.label}</option>)}
                </select>
              </label>
              <label className="block text-xs md:col-span-2">
                <span className="mb-1 block font-semibold text-[var(--theme-muted)]">Labels</span>
                <input value={draftLabels} onChange={(event) => setDraftLabels(event.target.value)} placeholder="label:Hermes/Workspace, priority:high" className="w-full rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-sm text-[var(--theme-text)] outline-none" />
                <span className="mt-1 block text-[10px] text-[var(--theme-muted)]">Use label:Business/Sub-scope for the two-tier board filter.</span>
              </label>
              <label className="flex items-center gap-2 self-end rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2 text-xs text-[var(--theme-muted)]">
                <input type="checkbox" checked={linkLatestMission} disabled={!latestMission} onChange={(event) => setLinkLatestMission(event.target.checked)} />
                Link latest mission{latestMission ? `: ${latestMission.title}` : ''}
              </label>
              {createMutation.error ? <div className="rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 md:col-span-2">{createMutation.error.message}</div> : null}
              <div className="flex justify-end gap-2 md:col-span-2">
                <button type="button" onClick={() => setComposerOpen(false)} className="rounded-xl border border-[var(--theme-border)] px-3 py-2 text-xs font-semibold text-[var(--theme-muted)] hover:bg-[var(--theme-card2)]">Cancel</button>
                <button type="button" disabled={!draftTitle.trim() || createMutation.isPending} onClick={() => void handleCreateCard()} className="rounded-xl bg-[var(--theme-accent)] px-3 py-2 text-xs font-semibold text-primary-950 disabled:opacity-50">{createMutation.isPending ? 'Saving…' : 'Create card'}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {query.isError ? (
        <div className="rounded-2xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-700">Kanban failed to load: {query.error.message}</div>
      ) : query.isPending ? (
        <div className="mb-3 rounded-2xl border border-dashed border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-3 text-sm text-[var(--theme-muted)]">
          Loading board cards and backend source…
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3 2xl:grid-cols-6">
        {LANES.map((lane) => {
          const laneCards = cardsByLane.get(lane.id) ?? []
          return (
            <div key={lane.id} className="min-h-64 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg)] p-2">
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]', LANE_TONE[lane.id])}>{lane.label}</span>
                    <span className="text-[10px] text-[var(--theme-muted)]">{laneCards.length}</span>
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--theme-muted)]">{lane.hint}</div>
                </div>
              </div>
              <div className="space-y-2">
                {query.isPending ? (
                  <div className="rounded-xl border border-dashed border-[var(--theme-border)] p-3 text-xs text-[var(--theme-muted)]">Waiting for source…</div>
                ) : laneCards.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--theme-border)] p-3 text-xs text-[var(--theme-muted)]">Empty</div>
                ) : laneCards.map((card) => (
                  <article key={card.id} className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3 text-left shadow-sm">
                    <div className="text-sm font-semibold leading-snug text-[var(--theme-text)]">{card.title}</div>
                    {card.spec ? <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-[var(--theme-muted-2)]">{card.spec}</p> : null}
                    {card.acceptanceCriteria.length ? (
                      <ul className="mt-2 space-y-1 text-[11px] text-[var(--theme-muted)]">
                        {card.acceptanceCriteria.slice(0, 3).map((item, index) => <li key={`${card.id}-ac-${index}`}>✓ {item}</li>)}
                        {card.acceptanceCriteria.length > 3 ? <li>+${card.acceptanceCriteria.length - 3} more</li> : null}
                      </ul>
                    ) : null}
                    {card.tags?.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {card.tags.slice(0, 4).map((tag) => {
                          const parsed = parseTaskLabel(tag)
                          return parsed ? (
                            <span key={tag} className={cn('rounded-full border px-1.5 py-0.5 text-[9px] font-semibold', parsed.color)}>
                              {parsed.tier1}{parsed.tier2 ? <span className="opacity-70">/${parsed.tier2}</span> : null}
                            </span>
                          ) : (
                            <span key={tag} className="rounded-full border border-[var(--theme-border)] px-1.5 py-0.5 text-[9px] text-[var(--theme-muted)]">{tag}</span>
                          )
                        })}
                      </div>
                    ) : null}
                    {card.status === 'running' || card.latestRun ? (
                      <div className="mt-2 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-2 py-1.5 text-[10px] text-emerald-700">
                        <div className="font-semibold">{card.status === 'running' ? `Running for ${formatElapsedSince(card.updatedAt)}` : 'Latest run'}</div>
                        {card.latestRun?.summary ? <div className="mt-0.5 line-clamp-2">{card.latestRun.summary}</div> : null}
                        {card.latestRun && (card.latestRun.status || card.latestRun.outcome) ? <div className="mt-0.5 opacity-75">{[card.latestRun.status, card.latestRun.outcome].filter(Boolean).join(' · ')}</div> : null}
                      </div>
                    ) : null}
                    <div className="mt-3 space-y-1 text-[10px] text-[var(--theme-muted)]">
                      <div>Owner: <span className="font-semibold text-[var(--theme-text)]">{workerLabel(workers, card.assignedWorker)}</span></div>
                      <div>Reviewer: <span className="font-semibold text-[var(--theme-text)]">{workerLabel(workers, card.reviewer)}</span></div>
                      {card.missionId ? <div className="truncate" title={card.missionId}>Mission: {card.missionId}</div> : null}
                      {card.reportPath ? <div className="truncate" title={card.reportPath}>Report: {card.reportPath}</div> : null}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {card.assignedWorker ? (
                        <button type="button" onClick={() => onSelectWorker?.(card.assignedWorker!)} className="rounded-full border border-[var(--theme-border)] px-2 py-1 text-[10px] font-semibold text-[var(--theme-muted)] hover:bg-[var(--theme-card2)] hover:text-[var(--theme-text)]">Open worker</button>
                      ) : null}
                      {card.status !== 'running' ? <button type="button" onClick={() => updateMutation.mutate({ id: card.id, updates: { status: 'running' } })} className="rounded-full border border-[var(--theme-border)] px-2 py-1 text-[10px] font-semibold text-[var(--theme-muted)] hover:bg-[var(--theme-card2)] hover:text-[var(--theme-text)]">Run</button> : null}
                      {card.status !== 'review' ? <button type="button" onClick={() => updateMutation.mutate({ id: card.id, updates: { status: 'review' } })} className="rounded-full border border-[var(--theme-border)] px-2 py-1 text-[10px] font-semibold text-[var(--theme-muted)] hover:bg-[var(--theme-card2)] hover:text-[var(--theme-text)]">Review</button> : null}
                      {card.status !== 'done' ? <button type="button" onClick={() => updateMutation.mutate({ id: card.id, updates: { status: 'done' } })} className="rounded-full border border-[var(--theme-border)] px-2 py-1 text-[10px] font-semibold text-[var(--theme-muted)] hover:bg-[var(--theme-card2)] hover:text-[var(--theme-text)]">Done</button> : null}
                      {onOpenRouter ? <button type="button" onClick={onOpenRouter} className="rounded-full border border-[var(--theme-accent)] bg-[var(--theme-accent-soft)] px-2 py-1 text-[10px] font-semibold text-[var(--theme-accent-strong)]">Router</button> : null}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
