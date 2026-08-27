import { createMemo, type Accessor } from "solid-js"
import { useLayout } from "@/context/layout"
import { useServerSync } from "@/context/server-sync"

// Dialogs mount under their caller's owner, which lacks the directory-scoped
// SDKProvider. Resolve a usable directory so dialogs can wrap themselves in one.
export function useDialogDirectory(): Accessor<string | undefined> {
  const layout = useLayout()
  const serverSync = useServerSync()

  return createMemo(() => {
    const route = layout.route()
    if (route.type === "dir-new-sesssion") return route.dir
    if (route.type === "session") return serverSync().session.get(route.sessionId)?.directory
    return layout.projects.list()[0]?.worktree ?? serverSync().data.path.directory
  })
}
