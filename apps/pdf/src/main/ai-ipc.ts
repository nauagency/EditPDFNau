import { app, ipcMain, net, shell, webContents } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AiCreditsError,
  AiTimeoutError,
  activeProvider,
  defaultAiSettings,
  isAiNetworkError,
  isAiOverloadedError,
  isAiRegionBlockedError,
  maxOutputTokensOf,
  resolveAiSettings,
  resolveProfileCredential,
  sanitizeAiSettings,
  setAiUserAgent,
  setRescueFetch,
  streamForProvider,
  type AiSettings,
  type AiStreamChunk,
  type AiStreamRequest,
  type GenSparkAccountStatus,
  type LegacyAiSettings,
} from '@genoffice/ai-provider'
import { shutdownCodexAppServers } from '@genoffice/ai-provider/codex-app-server'
import { startAiTrace } from '@genoffice/ai-provider/trace'
import {
  abortOnDestroyed,
  fetchRemoteImage,
  MAX_REMOTE_IMAGE_BYTES,
  readBodyCapped,
  writeJsonAtomic,
} from '@genoffice/electron-utils'
import { imageSearchTool } from '@genoffice/ai-search'
import { AI_CHANNELS, type UserSkillEntry } from '../shared/ipc'

const settingsPath = () => join(app.getPath('userData'), 'ai-settings.json')
const activeStreams = new Map<string, AbortController>()

function readJson<T>(path: string, fallback: T): T {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    // A damaged settings file must not prevent the PDF editor from opening.
  }
  return fallback
}

function currentSettings(): AiSettings {
  const stored = readJson<Partial<AiSettings> & LegacyAiSettings>(settingsPath(), {})
  const settings = resolveAiSettings(stored, defaultAiSettings())
  settings.provider = activeProvider(settings)
  return settings
}

function broadcastSettingsChanged(): void {
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed()) wc.send(AI_CHANNELS.settingsChanged)
  }
}

/** Register the AI bridge needed when the PDF app runs without the Office shell. */
export function registerPdfAiIpc(): void {
  app.once('before-quit', shutdownCodexAppServers)
  setRescueFetch((url, init) => net.fetch(url, init))
  setAiUserAgent(`EditPDFNau/${app.getVersion()}`)

  ipcMain.handle(AI_CHANNELS.getSettings, () => currentSettings())
  ipcMain.handle(AI_CHANNELS.setSettings, (_event, settings: AiSettings) => {
    const sanitized = sanitizeAiSettings(settings)
    if (!sanitized) throw new Error('Invalid AI settings')
    writeJsonAtomic(settingsPath(), sanitized)
    broadcastSettingsChanged()
  })

  ipcMain.handle(
    AI_CHANNELS.gskStatus,
    async (): Promise<GenSparkAccountStatus> => ({ loggedIn: false }),
  )

  ipcMain.handle('ai:gsk-login', () => false)

  // The standalone MVP has no Office home/settings window. Keep settings in a
  // portable JSON file and reveal it in Explorer for BYOK configuration.
  const revealSettings = () => {
    const path = settingsPath()
    if (!existsSync(path)) writeFileSync(path, JSON.stringify(defaultAiSettings(), null, 2))
    shell.showItemInFolder(path)
  }
  ipcMain.handle(AI_CHANNELS.openModelSettings, revealSettings)
  ipcMain.handle(AI_CHANNELS.openSkillsSettings, revealSettings)
  ipcMain.handle(AI_CHANNELS.skillsList, async (): Promise<UserSkillEntry[]> => [])
  ipcMain.handle(AI_CHANNELS.skillText, async () => '')

  ipcMain.handle(AI_CHANNELS.stream, async (event, request: AiStreamRequest) => {
    const settings = sanitizeAiSettings(request.settings)
    if (!settings) {
      event.sender.send(AI_CHANNELS.streamChunk, {
        requestId: request.requestId,
        type: 'error',
        error: 'Invalid AI settings',
      } satisfies AiStreamChunk)
      return
    }

    const { requestId, system, messages } = request
    const tools = request.tools ?? []
    const maxTokens = request.maxTokens ?? maxOutputTokensOf(settings)
    const provider = settings.provider
    let config = settings.providers?.[provider]
    config = config ? resolveProfileCredential(config) : config

    const send = (chunk: AiStreamChunk) => {
      if (!event.sender.isDestroyed()) event.sender.send(AI_CHANNELS.streamChunk, chunk)
    }
    if (!config || (provider !== 'codex' && !config.apiKey)) {
      send({
        requestId,
        type: 'error',
        error: `Configure ${provider} in EditPDFNau AI settings first.`,
      })
      return
    }
    if (provider !== 'codex' && !config.model) {
      send({ requestId, type: 'error', error: 'Choose an AI model first.' })
      return
    }

    const controller = new AbortController()
    activeStreams.set(requestId, controller)
    const unwatchSender = abortOnDestroyed(event.sender, controller)
    const trace = startAiTrace({
      requestId,
      sessionId: request.sessionId,
      source: event.sender.getURL(),
      provider,
      model: config.model,
      maxTokens,
      system,
      messages,
      tools,
    })
    try {
      let stopReason: string | undefined
      await streamForProvider(provider, config, system, messages, tools, maxTokens, {
        ...(request.sessionId ? { sessionId: request.sessionId } : {}),
        signal: controller.signal,
        onDelta: (text) => {
          trace?.onDelta(text)
          send({ requestId, type: 'delta', text })
        },
        onReasoningDelta: (text) => {
          trace?.onReasoningDelta(text)
          send({ requestId, type: 'reasoning', text })
        },
        onToolCall: (toolCall) => {
          trace?.onToolCall(toolCall)
          send({ requestId, type: 'tool-call', toolCall })
        },
        onStopReason: (reason) => {
          stopReason = reason
          trace?.onStopReason(reason)
        },
        onUsage: (usage) => {
          trace?.onUsage(usage)
          send({ requestId, type: 'usage', usage })
        },
      })
      trace?.finish()
      send(stopReason ? { requestId, type: 'done', stopReason } : { requestId, type: 'done' })
    } catch (error) {
      trace?.finish(
        controller.signal.aborted
          ? 'aborted'
          : error instanceof Error
            ? error.message
            : String(error),
      )
      if (controller.signal.aborted) {
        send({ requestId, type: 'done' })
      } else {
        send({
          requestId,
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
          ...(error instanceof AiTimeoutError
            ? { errorCode: 'timeout' as const }
            : error instanceof AiCreditsError
              ? { errorCode: 'credits' as const }
              : isAiNetworkError(error)
                ? { errorCode: 'network' as const }
                : isAiOverloadedError(error)
                  ? { errorCode: 'overloaded' as const }
                  : isAiRegionBlockedError(error)
                    ? { errorCode: 'region' as const }
                    : {}),
        })
      }
    } finally {
      unwatchSender()
      activeStreams.delete(requestId)
    }
  })

  ipcMain.handle(AI_CHANNELS.streamCancel, (_event, requestId: string) => {
    activeStreams.get(requestId)?.abort()
  })

  ipcMain.handle(AI_CHANNELS.imageSearch, async (_event, query: string, maxResults?: number) => {
    try {
      return await imageSearchTool(settingsPath(), String(query), maxResults ?? 8)
    } catch (error) {
      return { images: [], method: 'error', error: String(error) }
    }
  })

  ipcMain.handle(
    AI_CHANNELS.fetchImage,
    async (_event, url: string): Promise<{ base64: string; mime: string } | null> => {
      try {
        const response = await fetchRemoteImage(String(url))
        if (!response?.ok) return null
        const buffer = Buffer.from(await readBodyCapped(response, MAX_REMOTE_IMAGE_BYTES))
        const contentType = response.headers.get('content-type') ?? ''
        const mime = contentType.includes('png')
          ? 'image/png'
          : contentType.includes('gif')
            ? 'image/gif'
            : 'image/jpeg'
        return { base64: buffer.toString('base64'), mime }
      } catch {
        return null
      }
    },
  )
}
