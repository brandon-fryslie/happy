# Project Directories — User Workflow

A per-machine list of "project root" directories. When you start a new session, you pick which subdirectory under one of those roots you want to work in — no more typing the full path.

This is fork-only; upstream's new-session screen only offers a text input + recent paths.

## Mental model

- A **project directory** is a root folder on one of your machines that contains a bunch of projects as subdirectories (e.g. `~/projects`, `~/work`, `/srv/clients`).
- You **configure roots per machine**. Different machines can have different roots, or the same path written differently (e.g. `~/projects` on macOS, `/home/me/projects` on a Linux box).
- The picker shows **direct children only** — one level deep, no recursion. If `~/projects` contains `~/projects/foo`, you see `foo`. If `~/projects/foo/sub` exists, you don't — pick `foo`, then the session's cwd is `~/projects/foo` and the agent can navigate further itself.
- Hidden directories (starting with `.`) are excluded from the listing.

## Workflow

### First-time setup — adding a project directory

1. Open the app and tap **New Session**.
2. Pick the machine you want (it must be online — listing happens via the daemon's `listDirectory` RPC).
3. Tap the **path row** to open the path picker.
4. In the path picker's text input, type the root path you want to register, e.g. `~/projects`.
5. Tap the **+** icon next to the "Projects" section header. The path is saved under the currently-selected machine.
6. The "Projects" section now shows a group for `~/projects` with its subdirectories listed underneath.

You can repeat steps 4–5 to add more roots for the same machine — each appears as its own group in the picker.

### Day-to-day — starting a session in a project

1. Tap **New Session**.
2. Pick your machine.
3. Tap the path row.
4. Under the **Projects** section, find the right root group, then tap the subdirectory you want.
5. The text input fills in with the full path (e.g. `~/projects/my-app`).
6. Close the picker (Done button on iOS, tap outside on web), write your prompt, and send.

The session spawns in that subdirectory just as if you'd typed the path by hand.

### Removing a project directory

1. Open the path picker for the relevant machine.
2. In the "Projects" section, each root group has an **×** button on its header row.
3. Tap **×** to remove that root from the machine's list. (The directory on disk is untouched — this only removes the bookmark.)

### Switching machines

The "Projects" section is **machine-scoped**. When you change the selected machine in the new-session screen, the picker re-runs `listDirectory` against the new machine's roots and shows that machine's subdirectories. A root configured for machine A won't appear when machine B is selected.

## What's stored, and where

Configuration lives in the app's encrypted settings (`projectsMachinePaths` in `packages/happy-app/sources/sync/settings.ts`). The shape is a flat array:

```ts
projectsMachinePaths: Array<{ machineId: string; path: string }>
```

Multiple entries with the same `machineId` = multiple roots for that machine. The list syncs across your devices the same way every other setting does (via the encrypted `Account.settings` blob on the server — the server can't read it).

## How the picker actually fetches subdirectories

When the picker opens for a given machine, the `useProjectDirectories` hook:

1. Filters `projectsMachinePaths` to entries matching the selected `machineId`.
2. For each configured root, fires a parallel `machineRPC(machineId, 'listDirectory', { path: resolvedRoot })` — no active session needed; the handler is registered on the daemon itself via `registerCommonHandlers`.
3. Filters the response to `type === 'directory'`, drops hidden entries, sorts alphabetically.

If a machine is offline the picker shows the loading spinner and then the error from the RPC. If a root no longer exists on disk, the error from the daemon is surfaced in place of the subdirectory list for that group — the bookmark sticks around so you can fix the typo and retry.

## Why per-machine + flat array (instead of one global path)

- Different machines have different filesystem layouts. A laptop might use `~/code`; a server might use `/srv/clients`. Asking the user to pick one global value that works everywhere doesn't survive a second machine.
- Some users want multiple roots even on one machine (work vs personal vs experiments). The flat array `[{machineId, path}, ...]` supports that without nesting.
- The settings schema documents a hard rule: **flat objects, one field per setting** (see `settings.ts:73-76`). A nested `{ machineId: string[] }` map would violate that and break the partial-Zod migration contract used for forward compatibility. Mirroring the existing `recentMachinePaths` shape lets the same forward/backward-compat behavior apply automatically.

## Why direct-children-only (no recursion, no tree)

- The user's mental model is "pick a project," not "navigate a filesystem." A project is one level under a project root.
- Recursive listing means N round-trips and unbounded data — most `~/projects` folders have `node_modules`, `.git`, etc. nested deeply. The current shape: one RPC per root, fixed cost.
- If a user actually wants `~/projects/foo/sub`, they can still type it in the text input, or pick `foo` and let the agent `cd sub` once the session starts.

## Limitations / known rough edges

- **Offline machines:** the listing RPC fails immediately; you'll see the error text under the group header. Adding a root works (it's just settings), but you won't see subdirectories until the daemon is reachable.
- **Stale listings:** the picker fetches once when it opens. If you create a new subdirectory on the machine while the picker is open, you have to close and reopen.
- **No reordering:** roots show up in the order they were added. There's no drag-to-reorder.
- **No bulk import:** if you want to register five roots, that's five `+` taps.

These are all fixable later if they bite; nothing about the data shape forces them to stay.
