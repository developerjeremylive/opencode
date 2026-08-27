import { createMemo, createSignal, For, Show } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Switch } from "@opencode-ai/ui/switch"
import { useLanguage } from "@/context/language"
import { usePlugins } from "@/hooks/use-plugins"

export function DialogPlugins() {
  const language = useLanguage()
  const plugins = usePlugins()
  const [busy, setBusy] = createSignal<string | undefined>()
  const activeCount = createMemo(() => plugins.items().filter((item) => item.active).length)

  return (
    <Dialog
      title={language.t("page.plugins.title")}
      description={language.t("page.plugins.description", { active: activeCount(), total: plugins.items().length })}
    >
      <div class="flex flex-col gap-3 px-3 pb-3 min-w-[min(640px,90vw)]">
        <Show
          when={plugins.items().length > 0}
          fallback={
            <div class="text-14-regular text-text-base text-center py-6">{language.t("dialog.plugins.empty")}</div>
          }
        >
          <div class="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
            <For each={plugins.items()}>
              {(item) => (
                <div
                  classList={{
                    "flex flex-col gap-2 rounded-lg border p-3": true,
                    "border-border-weak-base": item.active,
                    "border-border-weaker-base opacity-60": !item.active,
                  }}
                >
                  <div class="flex items-start justify-between gap-2">
                    <span class="text-14-medium text-text-strong truncate" title={item.name}>
                      {item.name}
                    </span>
                    <Switch
                      checked={item.active}
                      disabled={busy() === item.name}
                      onChange={(next) => {
                        setBusy(item.name)
                        void plugins.write(item.name, item.entry, next).finally(() => setBusy(undefined))
                      }}
                    />
                  </div>
                  <span class="text-11-regular text-text-weaker">
                    {item.active ? language.t("plugins.state.active") : language.t("plugins.state.inactive")}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}
