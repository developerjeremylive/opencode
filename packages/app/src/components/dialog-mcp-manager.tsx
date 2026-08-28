import { createMemo, createSignal, For, Show, onMount, createEffect } from "solid-js"
import type { Config } from "@opencode-ai/sdk/v2/client"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Switch } from "@opencode-ai/ui/switch"
import { Popover } from "@opencode-ai/ui/popover"
import { TextField } from "@opencode-ai/ui/text-field"
import { useLanguage } from "@/context/language"
import { useSync } from "@/context/sync"
import { useMcpToggle } from "@/context/mcp"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { useQueryClient } from "@tanstack/solid-query"

const statusLabels = {
  connected: "mcp.status.connected",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  needs_client_registration: "mcp.status.needs_auth",
  disabled: "mcp.status.disabled",
} as const

const LOCAL_MCP_KEY = "opencode.mcp.local.config"

function localKeyFor(dir: string): string {
  return `${LOCAL_MCP_KEY}:${encodeURIComponent(dir ?? "global")}`
}

function loadLocalMcp(dir: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(localKeyFor(dir))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

function saveLocalMcp(dir: string, config: Record<string, unknown>): void {
  try {
    localStorage.setItem(localKeyFor(dir), JSON.stringify(config))
  } catch {
    // ignore
  }
}

export function DialogMcpManager() {
  const language = useLanguage()
  const sync = useSync()
  const serverSync = useServerSync()
  const toggle = useMcpToggle()
  const queryClient = useQueryClient()

  const [addOpen, setAddOpen] = createSignal(false)
  const [name, setName] = createSignal("")
  const [type, setType] = createSignal<"local" | "remote">("local")
  const [command, setCommand] = createSignal("")
  const [url, setUrl] = createSignal("")
  const [enabled, setEnabled] = createSignal(true)
  const [saving, setSaving] = createSignal(false)
  const [jsonEditing, setJsonEditing] = createSignal(false)
  const [warnUnsaved, setWarnUnsaved] = createSignal(false)

  // Directorio actual para localStorage (usa el del server si está disponible)
  const directory = createMemo(() => serverSync().data.path?.directory ?? "")
  const localDir = createMemo(() => directory() || "global")

  // Config del servidor (reactiva desde TanStack Query)
  const serverConfig = createMemo(() => serverSync().configQuery.data ?? {})
  const serverMcpConfig = createMemo(() => {
    const cfg = serverConfig()
    return cfg.mcp && typeof cfg.mcp === "object" ? (cfg.mcp as Record<string, unknown>) : {}
  })

  // Config local de fallback (localStorage)
  const localMcpConfig = createMemo(() => loadLocalMcp(localDir()))

  // Config efectiva: prefiere servidor si tiene datos, luego localStorage, luego {}
  // Filtra entradas con enabled:false (servidores eliminados via JSON)
  const effectiveMcpConfig = createMemo(() => {
    const s = serverMcpConfig()
    if (Object.keys(s).length > 0) {
      return Object.fromEntries(
        Object.entries(s).filter(([, v]) => {
          if (v && typeof v === "object" && "enabled" in v && (v as Record<string, unknown>).enabled === false) return false
          return true
        })
      )
    }
    const l = localMcpConfig()
    return l ?? {}
  })

  // ¿Estamos en modo offline (server vacío pero local tiene datos)?
  const isOffline = createMemo(() => {
    return Object.keys(serverMcpConfig()).length === 0 && Object.keys(localMcpConfig()).length > 0
  })

  const mcpJsonText = createMemo(() => JSON.stringify(effectiveMcpConfig(), null, 2))

  // Detecta si hay cambios no guardados (solo cuando estamos editando)
  const hasUnsavedChanges = createMemo(() => {
    if (!jsonEditing()) return false
    return text() !== mcpJsonText()
  })

  const items = createMemo(() => {
    const config = effectiveMcpConfig()
    const status = sync().data.mcp ?? {}
    return Object.keys(config)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        const entry = config[name]
        const kind =
          entry && typeof entry === "object" && "type" in entry
            ? entry.type
            : entry && typeof entry === "object" && "enabled" in entry
              ? undefined
              : undefined
        return { name, status: status[name]?.status, kind }
      })
  })
  const connected = createMemo(() => items().filter((item) => item.status === "connected").length)

  const [text, setText] = createSignal("")

  createEffect(() => {
    if (jsonEditing()) return
    const cfg = effectiveMcpConfig()
    setText(JSON.stringify(cfg, null, 2))
  })

  // Al montar, cargar config actual (servidor o localStorage)
  onMount(() => {
    const cfg = effectiveMcpConfig()
    setText(JSON.stringify(cfg, null, 2))
  })

  const parsed = createMemo(() => {
    try {
      const value = JSON.parse(text())
      if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
      return value as Record<string, unknown>
    } catch (e) {
      console.error("[MCP] JSON parse error:", e, "text:", JSON.stringify(text()))
      return undefined
    }
  })

  const saveJson = async () => {
    const value = parsed()
    if (!value) {
      showToast({ variant: "error", title: language.t("mcp.json.parseError") })
      return
    }
    setSaving(true)
    try {
      const config = serverConfig()

      saveLocalMcp(localDir(), value)

      const previousMcp = config.mcp && typeof config.mcp === "object" ? (config.mcp as Record<string, unknown>) : {}
      const patched = { ...value }
      for (const key of Object.keys(previousMcp)) {
        if (!(key in value)) {
          patched[key] = { enabled: false }
        }
      }

      const fullConfig = { ...config, mcp: patched } as Config

      try {
        await serverSync().updateConfig(fullConfig)
        showToast({ variant: "success", title: language.t("mcp.json.saved") })
        setWarnUnsaved(false)
      } catch (serverError) {
        showToast({
          variant: "warning",
          title: language.t("mcp.json.savedLocal"),
          description: language.t("mcp.json.savedLocalDesc"),
        })
      }

      setText(JSON.stringify(value, null, 2))
      setJsonEditing(false)
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
      resetJson()
    }
    setSaving(false)
  }

  const resetJson = () => {
    console.log("[MCP] resetJson called")
    setText(mcpJsonText())
    setWarnUnsaved(false)
  }

  const addServer = async (close: () => void) => {
    const id = name().trim()
    if (!id) return
    const entry =
      type() === "local"
        ? { type: "local", command: command().trim().split(/\s+/).filter(Boolean), enabled: enabled() }
        : { type: "remote", url: url().trim(), enabled: enabled() }
    setSaving(true)
    try {
      const config = serverConfig()
      const currentMcp = config.mcp && typeof config.mcp === "object" ? (config.mcp as Record<string, unknown>) : {}

      // 1. Guardar en localStorage inmediatamente
      const updatedMcp = { ...currentMcp, [id]: entry }
      saveLocalMcp(localDir(), updatedMcp)

      try {
        const fullConfig = { ...config, mcp: updatedMcp } as Config
        await serverSync().updateConfig(fullConfig)
        showToast({ variant: "success", title: language.t("mcp.add.added", { name: id }) })
      } catch (serverError) {
        console.warn("[MCP] server add failed, saved locally:", serverError)
        showToast({
          variant: "warning",
          title: language.t("mcp.add.addedLocal"),
          description: language.t("mcp.add.addedLocalDesc", { name: id }),
        })
      }

      // Actualizar el textarea con lo que se guardó
      const finalMcp = Object.keys(serverMcpConfig()).length > 0
        ? { ...serverMcpConfig(), [id]: entry }
        : updatedMcp
      setText(JSON.stringify(finalMcp, null, 2))
      setName("")
      setCommand("")
      setUrl("")
      close()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    }
    setSaving(false)
  }

  return (
    <Dialog size="x-large" fit title={language.t("page.mcp.title")} description={language.t("page.mcp.description", { connected: connected(), total: items().length })}>
      <div class="flex flex-col gap-4 px-3 pb-3 max-h-[75vh] overflow-y-auto">
        {/* Header con badge offline */}
        <div class="flex items-center justify-between gap-2">
          <span class="text-12-medium text-text-weak">{language.t("page.mcp.cards")}</span>
          <Show when={isOffline()}>
            <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-icon-warning-base/10 text-11-medium text-icon-warning-base">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {language.t("mcp.offlineBadge")}
            </span>
          </Show>
          <Popover
            open={addOpen()}
            onOpenChange={setAddOpen}
            placement="bottom-end"
            class="w-72"
            trigger={
              <Button size="small" icon="plus">
                {language.t("mcp.add")}
              </Button>
            }
          >
            <div class="flex flex-col gap-3 p-3">
              <TextField label={language.t("mcp.add.name")} value={name()} onChange={setName} />
              <div class="flex flex-col gap-1">
                <span class="text-12-medium text-text-strong">{language.t("mcp.add.type")}</span>
                <div class="flex gap-2">
                  <Button size="small" variant={type() === "local" ? "primary" : "secondary"} onClick={() => setType("local")}>
                    {language.t("mcp.add.type.local")}
                  </Button>
                  <Button size="small" variant={type() === "remote" ? "primary" : "secondary"} onClick={() => setType("remote")}>
                    {language.t("mcp.add.type.remote")}
                  </Button>
                </div>
              </div>
              <Show
                when={type() === "local"}
                fallback={<TextField label={language.t("mcp.add.url")} value={url()} onChange={setUrl} placeholder="https://example.com/mcp" />}
              >
                <TextField
                  label={language.t("mcp.add.command")}
                  value={command()}
                  onChange={setCommand}
                  placeholder="npx -y @example/mcp-server"
                />
              </Show>
              <div class="flex items-center justify-between">
                <span class="text-12-medium text-text-strong">{language.t("mcp.add.enabled")}</span>
                <Switch checked={enabled()} onChange={setEnabled} />
              </div>
              <Button size="small" variant="primary" disabled={saving() || !name().trim()} onClick={() => void addServer(() => setAddOpen(false))}>
                {language.t("mcp.add.submit")}
              </Button>
            </div>
          </Popover>
        </div>

        {/* MCP Cards: se renderizan desde effectiveMcpConfig (server o localStorage) */}
        <Show
          when={items().length > 0}
          fallback={<div class="text-14-regular text-text-base text-center py-6">{language.t("dialog.mcp.empty")}</div>}
        >
          <div class="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
            <For each={items()}>
              {(item) => {
                const status = () => item.status
                const label = () => (status() ? language.t(statusLabels[status() as keyof typeof statusLabels]) : undefined)
                const on = () => status() === "connected"
                return (
                  <div class="flex flex-col gap-2 rounded-lg border border-border-weak-base bg-background-base p-3">
                    <div class="flex items-start justify-between gap-2">
                      <span class="text-14-medium text-text-strong truncate" title={item.name}>
                        {item.name}
                      </span>
                      <div class="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
                        <Switch
                          checked={on()}
                          disabled={!status() || status() === "pending" || (toggle.isPending && toggle.variables === item.name)}
                          onChange={() => {
                            if (toggle.isPending) return
                            toggle.mutate(item.name)
                          }}
                        />
                      </div>
                    </div>
                    <div class="flex items-center gap-2 text-11-regular text-text-weaker">
                      <div
                        classList={{
                          "size-1.5 rounded-full shrink-0": true,
                          "bg-icon-success-base": status() === "connected",
                          "bg-icon-critical-base": status() === "failed",
                          "bg-border-weak-base": !status() || status() === "disabled",
                          "bg-icon-warning-base": status() === "needs_auth" || status() === "needs_client_registration",
                        }}
                      />
                      <span class="truncate">
                        {item.kind ? `${item.kind} · ` : ""}
                        {label() ?? language.t("plugins.state.inactive")}
                      </span>
                    </div>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>

        {/* JSON Editor */}
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <span class="text-12-medium text-text-weak">{language.t("mcp.json.title")}</span>
            <div class="flex gap-2">
              <Show when={jsonEditing() || text() === ""} fallback={<Button size="small" variant="ghost" onClick={() => { setJsonEditing(true); showToast({ variant: "info", title: language.t("mcp.json.editNotice") }) }}>{language.t("mcp.json.edit")}</Button>}>
                <Button size="small" variant="ghost" onClick={resetJson}>
                  {language.t("mcp.json.reset")}
                </Button>
                <Show when={jsonEditing()}>
                  <Button size="small" variant="ghost" disabled={hasUnsavedChanges()} onClick={() => { setText(mcpJsonText()); setJsonEditing(false) }}>
                    {language.t("mcp.json.cancel")}
                  </Button>
                  <Button size="small" variant="primary" disabled={!parsed() || saving()} onClick={() => { console.log("[MCP] save clicked, parsed:", parsed(), "text:", text()); void saveJson() }}>
                    {language.t("mcp.json.save")}
                  </Button>
                </Show>
              </Show>
            </div>
          </div>
          <textarea
            class="w-full h-56 resize-y rounded-lg border border-border-weak-base bg-background-base p-3 font-mono text-12-regular text-text-base outline-none focus:border-text-interactive-base"
            spellcheck={false}
            readonly={!jsonEditing()}
            value={text()}
            onInput={(event) => { setText(event.currentTarget.value); setWarnUnsaved(true) }}
          />
          <Show when={text() && !parsed()}>
            <span class="text-11-regular text-text-diff-delete-base">{language.t("mcp.json.invalid")}</span>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
