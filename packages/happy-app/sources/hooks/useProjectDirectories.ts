/**
 * useProjectDirectories — manages per-machine project directory roots and fetches
 * their immediate subdirectories on demand.
 *
 * A "project directory" is a root folder (e.g. ~/projects) whose subdirectories are
 * shown as selectable items in the new-session path picker.  Multiple roots per machine
 * are supported.  Each root's subdirectories are fetched in parallel via the daemon's
 * listDirectory machine RPC (no active session required).
 */

import React from 'react';
import { useSettingMutable } from '@/sync/storage';
import { machineListDirectory } from '@/sync/ops';
import { resolveAbsolutePath } from '@/utils/pathUtils';
import { formatPathRelativeToHome } from '@/utils/sessionUtils';

export type ProjectDirItem = { key: string; label: string };

export type ProjectDirGroup = {
    /** The configured root path as stored in settings (may contain ~). */
    rootPath: string;
    /** Resolved absolute path of the root (~ expanded using homeDir). */
    resolvedRootPath: string;
    /** Immediate subdirectories of rootPath, sorted alphabetically, hidden dirs excluded. */
    items: ProjectDirItem[];
    loading: boolean;
    error: string | null;
};

/**
 * Returns project directory groups for the given machine and callbacks to add/remove roots.
 *
 * Re-fetches whenever the set of configured roots or the machineId changes.
 */
export function useProjectDirectories(
    machineId: string | null,
    homeDir?: string,
): {
    groups: ProjectDirGroup[];
    addProjectPath: (path: string) => void;
    removeProjectPath: (path: string) => void;
} {
    const [projectsMachinePaths, setProjectsMachinePaths] = useSettingMutable('projectsMachinePaths');

    // [LAW:one-source-of-truth] Filter once; all downstream reads use this derived list.
    const machineRoots = React.useMemo(
        () =>
            machineId
                ? projectsMachinePaths
                      .filter((p) => p.machineId === machineId)
                      .map((p) => p.path)
                : [],
        [projectsMachinePaths, machineId],
    );

    const [groups, setGroups] = React.useState<ProjectDirGroup[]>([]);

    // Dependency key: re-run when roots change (join is safe because paths are strings).
    const rootsKey = machineRoots.join('\n');

    React.useEffect(() => {
        if (!machineId || machineRoots.length === 0) {
            setGroups([]);
            return;
        }

        // Immediately show loading placeholders so the UI doesn't flash empty → populated.
        setGroups(
            machineRoots.map((rootPath) => ({
                rootPath,
                resolvedRootPath: resolveAbsolutePath(rootPath, homeDir),
                items: [],
                loading: true,
                error: null,
            })),
        );

        let cancelled = false;

        Promise.all(
            machineRoots.map(async (rootPath) => {
                const resolvedRootPath = resolveAbsolutePath(rootPath, homeDir);
                const result = await machineListDirectory(machineId, resolvedRootPath);
                return { rootPath, resolvedRootPath, result };
            }),
        ).then((results) => {
            if (cancelled) return;
            setGroups(
                results.map(({ rootPath, resolvedRootPath, result }) => {
                    if (!result.success || !result.entries) {
                        return {
                            rootPath,
                            resolvedRootPath,
                            items: [],
                            loading: false,
                            error: result.error ?? 'Failed to list directory',
                        };
                    }

                    const items = result.entries
                        .filter((e) => e.type === 'directory' && !e.name.startsWith('.'))
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((e) => {
                            const fullPath = `${resolvedRootPath}/${e.name}`;
                            return {
                                key: fullPath,
                                label: formatPathRelativeToHome(fullPath, homeDir),
                            };
                        });

                    return { rootPath, resolvedRootPath, items, loading: false, error: null };
                }),
            );
        });

        return () => {
            cancelled = true;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [machineId, rootsKey, homeDir]);

    const addProjectPath = React.useCallback(
        (path: string) => {
            if (!machineId || !path.trim()) return;
            const exists = projectsMachinePaths.some(
                (p) => p.machineId === machineId && p.path === path,
            );
            if (!exists) {
                setProjectsMachinePaths([...projectsMachinePaths, { machineId, path }]);
            }
        },
        [machineId, projectsMachinePaths, setProjectsMachinePaths],
    );

    const removeProjectPath = React.useCallback(
        (path: string) => {
            if (!machineId) return;
            setProjectsMachinePaths(
                projectsMachinePaths.filter(
                    (p) => !(p.machineId === machineId && p.path === path),
                ),
            );
        },
        [machineId, projectsMachinePaths, setProjectsMachinePaths],
    );

    return { groups, addProjectPath, removeProjectPath };
}
