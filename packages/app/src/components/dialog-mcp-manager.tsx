import { createMemo, createSignal, For, Show, onMount } from "solid-js"
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

const statusLabels = {
  connected: "mcp.status.connected",
  failed: "mcp.status.failed",
  needs_auth: "mcp.status.needs_auth",
  needs_client_registration: "mcp.status.needs_auth",
  disabled: "mcp.status.disabled",
} as const

export function DialogMcpManager() {
  const language = useLanguage()
  const sync = useSync()
  const serverSync = useServerSync()
  const toggle = useMcpToggle()

  const [addOpen, setAddOpen] = createSignal(false)
  const [name, setName] = createSignal("")
  const [type, setType] = createSignal<"local" | "remote">("local")
  const [command, setCommand] = createSignal("")
  const [url, setUrl] = createSignal("")
  const [enabled, setEnabled] = createSignal(true)
  const [saving, setSaving] = createSignal(false)
  const [jsonEditing, setJsonEditing] = createSignal(false)

  const mcpConfig = createMemo(() => serverSync().data.config.mcp ?? {})

  const items = createMemo(() => {
    const config = mcpConfig()
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

  // Seed the textarea with the current server config on mount.
  // This is the ONLY place that sets the initial value — no reactive
  // effect overwrites it afterwards.
  onMount(() => {
    const cfg = mcpConfig()
    console.log("[MCP] onMount mcpConfig:", JSON.stringify(cfg, null, 2))
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
    console.log("[MCP] saveJson called, parsed:", value)
    if (!value) {
      showToast({ variant: "error", title: language.t("mcp.json.parseError") })
      return
    }
    setSaving(true)
    try {
      const oldMcp = serverSync().data.config.mcp ?? {}
      const patched: Record<string, unknown> = { ...value }
      for (const key of Object.keys(oldMcp)) {
        if (!(key in patched)) {
          patched[key] = { enabled: false }
        }
      }
      const fullConfig = { ...serverSync().data.config, mcp: patched } as Config
      console.log("[MCP] sending config to server:", JSON.stringify(fullConfig, null, 2))
      await serverSync().updateConfig(fullConfig)
      setText(JSON.stringify(patched, null, 2))
      showToast({ variant: "success", title: language.t("mcp.json.saved") })
      setJsonEditing(false)
    } catch (error) {
      console.error("[MCP] saveJson error:", error)
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    }
    setSaving(false)
  }

  const resetJson = () => {
    console.log("[MCP] resetJson called")
    setText(JSON.stringify(mcpConfig(), null, 2))
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
      const fullConfig = { ...serverSync().data.config, mcp: { ...(serverSync().data.config.mcp ?? {}), [id]: entry } } as Config
      await serverSync().updateConfig(fullConfig)
      setText(JSON.stringify({ ...((serverSync().data.config.mcp ?? {}) as Record<string, unknown>), [id]: entry }, null, 2))
      showToast({ variant: "success", title: language.t("mcp.add.added", { name: id }) })
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
        <div class="flex items-center justify-between gap-2">
          <span class="text-12-medium text-text-weak">{language.t("page.mcp.cards")}</span>
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

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <span class="text-12-medium text-text-weak">{language.t("mcp.json.title")}</span>
            <div class="flex gap-2">
              <Show when={jsonEditing() || text() === ""} fallback={<Button size="small" variant="ghost" onClick={() => { setJsonEditing(true); showToast({ variant: "info", title: language.t("mcp.json.editNotice") }) }}>{language.t("mcp.json.edit")}</Button>}>
                <Button size="small" variant="ghost" onClick={resetJson}>
                  {language.t("mcp.json.reset")}
                </Button>
                <Show when={jsonEditing()}>
                  <Button size="small" variant="ghost" onClick={() => { setText(JSON.stringify(mcpConfig(), null, 2)); setJsonEditing(false) }}>
                    {language.t("mcp.json.cancel")}
                  </Button>
                  <Button size="small" variant="primary" disabled={!parsed()} onClick={() => { console.log("[MCP] save clicked, parsed:", parsed(), "text:", text()); void saveJson() }}>
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
            onInput={(event) => setText(event.currentTarget.value)}
          />
          <Show when={text() && !parsed()}>
            <span class="text-11-regular text-text-diff-delete-base">{language.t("mcp.json.invalid")}</span>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
