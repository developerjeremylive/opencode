import { createMemo } from "solid-js"
import type { Config } from "@opencode-ai/sdk/v2/client"
import { createStore, reconcile } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { Persist, persisted } from "@/utils/persist"
import { showToast } from "@/utils/toast"

export type PluginEntry = Config["plugin"] extends Array<infer T> | undefined ? T : never

export const pluginName = (entry: PluginEntry) => (typeof entry === "string" ? entry : entry[0])

// Disabled plugins keep their full config entry so they can be re-enabled later.
export function usePlugins() {
  const language = useLanguage()
  const serverSync = useServerSync()
  const [disabledStore, setDisabledStore] = persisted(
    Persist.global("plugins.disabled.v1"),
    createStore({} as Record<string, PluginEntry>),
  )

  const configured = createMemo(() => serverSync().data.config.plugin ?? [])
  const items = createMemo(() => {
    const active = configured().map((entry) => ({ name: pluginName(entry), entry, active: true }))
    const seen = new Set(active.map((item) => item.name))
    const inactive = Object.entries(disabledStore)
      .filter(([name]) => !seen.has(name))
      .map(([name, entry]) => ({ name, entry, active: false }))
    return [...active, ...inactive].sort((a, b) => a.name.localeCompare(b.name))
  })

  async function write(name: string, entry: PluginEntry, enable: boolean) {
    const next = enable ? [...configured(), entry] : configured().filter((item) => pluginName(item) !== name)
    try {
      await serverSync().updateConfig({ plugin: next } as Config)
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
      return
    }
    const stored = { ...disabledStore }
    if (enable) delete stored[name]
    else stored[name] = entry
    setDisabledStore(reconcile(stored))
  }

  return { items, write }
}
