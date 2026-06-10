import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { z } from 'zod'
import {
  createKanbanCard,
  getKanbanBackendMeta,
  listKanbanCards,
  updateKanbanCard,
  listKanbanBoards,
  createKanbanBoard,
  archiveKanbanBoard
} from '../../server/kanban-backend'
import { initFirm, getFirmStatus } from '../../server/firm-integration'
import * as path from 'node:path'
import { getHermesRoot } from '../../server/claude-paths'

const AcceptanceCriteriaSchema = z.preprocess(
  (value) => {
    if (Array.isArray(value)) return value
    if (typeof value === 'string') {
      return value
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)
    }
    return []
  },
  z.array(z.string().trim().min(1).max(5000)).default([]),
)

const TagsSchema = z.preprocess(
  (value) => {
    if (Array.isArray(value)) return value
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    }
    return []
  },
  z.array(z.string().trim().min(1).max(120)).default([]),
)

const CreateCardSchema = z.object({
  title: z.string().trim().min(1).max(200),
  spec: z.string().trim().max(5000).optional().default(''),
  acceptanceCriteria: AcceptanceCriteriaSchema,
  assignedWorker: z.string().trim().max(120).optional().nullable(),
  reviewer: z.string().trim().max(120).optional().nullable(),
  status: z.enum(['backlog', 'todo', 'ready', 'running', 'review', 'blocked', 'done']).optional().default('backlog'),
  missionId: z.string().trim().max(200).optional().nullable(),
  reportPath: z.string().trim().max(500).optional().nullable(),
  createdBy: z.string().trim().max(120).optional().default('aurora'),
  parents: z.array(z.string().trim().min(1).max(200)).optional().default([]),
  tags: TagsSchema,
  idempotencyKey: z.string().trim().max(500).optional().nullable(),
})

const UpdateCardSchema = CreateCardSchema.partial().extend({
  id: z.string().trim().min(1),
})

export const Route = createFileRoute('/api/swarm-kanban')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const board = url.searchParams.get('board') || undefined
        const action = url.searchParams.get('action')

        if (action === 'boards') {
          const boardsData = await listKanbanBoards()
          return json({
            ...boardsData,
            firm: await getFirmStatus()
          })
        }

        return json({
          ok: true,
          cards: await listKanbanCards(board),
          backend: getKanbanBackendMeta(board),
          firm: await getFirmStatus()
        })
      },
      POST: async ({ request }) => {
        const url = new URL(request.url)
        const board = url.searchParams.get('board') || undefined
        const action = url.searchParams.get('action')

        let body: unknown
        try {
          body = await request.json()
        } catch {
          return json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
        }

        if (action === 'boards') {
          const input = body as { slug: string; name?: string; description?: string; icon?: string }
          const b = await createKanbanBoard(input)

          // Firm integration: automatically initialize firm in the project folder
          const projectPath = path.join(getHermesRoot(), 'kanban', 'boards', b.slug)
          await initFirm(projectPath, { name: b.displayName || b.slug, description: b.description || undefined })

          return json({ ok: true, board: b })
        }

        const parsed = CreateCardSchema.safeParse(body)
        if (!parsed.success) {
          return json({ ok: false, error: parsed.error.issues.map((issue) => issue.message).join('; ') }, { status: 400 })
        }
        const data = parsed.data
        const card = await createKanbanCard({
          title: data.title,
          spec: data.spec,
          acceptanceCriteria: data.acceptanceCriteria,
          assignedWorker: data.assignedWorker,
          reviewer: data.reviewer,
          status: data.status,
          missionId: data.missionId,
          reportPath: data.reportPath,
          createdBy: data.createdBy,
          parents: data.parents,
          tags: data.tags,
          idempotencyKey: data.idempotencyKey,
        }, board)
        return json({ ok: true, card, backend: getKanbanBackendMeta(board) })
      },
      PATCH: async ({ request }) => {
        const url = new URL(request.url)
        const board = url.searchParams.get('board') || undefined

        let body: unknown
        try {
          body = await request.json()
        } catch {
          return json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
        }
        const parsed = UpdateCardSchema.safeParse(body)
        if (!parsed.success) {
          return json({ ok: false, error: parsed.error.issues.map((issue) => issue.message).join('; ') }, { status: 400 })
        }
        const { id, ...updates } = parsed.data
        const card = await updateKanbanCard(id, updates, board)
        if (!card) return json({ ok: false, error: 'Card not found' }, { status: 404 })
        return json({ ok: true, card, backend: getKanbanBackendMeta(board) })
      },
      DELETE: async ({ request }) => {
        const url = new URL(request.url)
        const action = url.searchParams.get('action')
        const slug = url.searchParams.get('slug')

        if (action === 'boards' && slug) {
          return json(await archiveKanbanBoard(slug))
        }
        return json({ ok: false, error: 'Method not allowed' }, { status: 405 })
      }
    },
  },
})
