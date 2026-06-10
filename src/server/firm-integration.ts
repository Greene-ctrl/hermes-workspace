import { execFileSync } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { getHermesRoot } from './claude-paths'

export type FirmStatus = {
  installed: boolean
  path?: string | null
  version?: string | null
}

/**
 * Check if the firm binary is installed and where.
 */
export async function getFirmStatus(): Promise<FirmStatus> {
  try {
    const firmBin = execFileSync('which', ['firm'], { encoding: 'utf8' }).trim()
    if (firmBin) {
      // Try to get version
      let version: string | null = null
      try {
        version = execFileSync(firmBin, ['--version'], { encoding: 'utf8' }).trim()
      } catch { /* ignore */ }

      return { installed: true, path: firmBin, version }
    }
  } catch {
    // Check common locations
    const commonPaths = ['/usr/local/bin/firm', '/usr/bin/firm', path.join(process.env.HOME || '', '.local/bin/firm')]
    for (const p of commonPaths) {
      if (fs.existsSync(p)) {
        return { installed: true, path: p }
      }
    }
  }
  return { installed: false }
}

/**
 * Firm integration for keeping track of company info.
 * Each project view can be a company/firm instance.
 */
export async function initFirm(projectPath: string, options: { name?: string; description?: string } = {}) {
  try {
    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true })
    }

    const status = await getFirmStatus()

    if (!status.installed || !status.path) {
      console.warn('[firm] firm binary not found, creating FIRM.md placeholder')
      fs.writeFileSync(path.join(projectPath, 'FIRM.md'), `# ${options.name || 'New Firm'}\n\n${options.description || 'Initialized via Hermes Workspace.'}\n\nAgent Role: Firm Updater\n\nNote: To enable full firm capabilities, install via: brew tap 42futures/firm && brew install firm\n`, 'utf8')
      return
    }

    // Initialize firm in the project directory
    execFileSync(status.path, ['init'], { cwd: projectPath })

    if (options.name) {
      try {
        execFileSync(status.path, ['update', '--name', options.name], { cwd: projectPath })
      } catch {
         try {
           execFileSync(status.path, ['config', 'set', 'name', options.name], { cwd: projectPath })
         } catch { /* ignore if fails */ }
      }
    }

    // Assign "firm updater" role as requested
    try {
       execFileSync(status.path, ['role', 'assign', 'firm-updater'], { cwd: projectPath })
    } catch { /* ignore */ }

  } catch (err) {
    console.error('[firm] Failed to initialize firm:', err)
  }
}

export async function getFirmInfo(projectPath: string) {
  const firmMdPath = path.join(projectPath, 'FIRM.md')
  if (fs.existsSync(firmMdPath)) {
    return {
      type: 'md',
      content: fs.readFileSync(firmMdPath, 'utf8')
    }
  }

  const status = await getFirmStatus()
  if (status.installed && status.path) {
    try {
      const info = execFileSync(status.path, ['info', '--json'], { cwd: projectPath, encoding: 'utf8' })
      return {
        type: 'json',
        data: JSON.parse(info)
      }
    } catch {
      return null
    }
  }
  return null
}

/**
 * Load a profile-specific config for a project/board.
 */
export async function loadBoardConfig(boardSlug: string) {
  const hermesRoot = getHermesRoot()
  const boardDir = path.join(hermesRoot, 'kanban', 'boards', boardSlug)
  const configPath = path.join(boardDir, 'board.yaml')

  let config: Record<string, any> = {}
  if (fs.existsSync(configPath)) {
    // config = YAML.parse(...)
  }

  return {
    boardSlug,
    path: boardDir,
    config,
    firm: await getFirmInfo(boardDir)
  }
}
