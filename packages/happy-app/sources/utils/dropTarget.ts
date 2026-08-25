/**
 * Does this drag carry files from outside the page?
 *
 * The answer decides whether the composer takes over a drag: intercepting one that
 * isn't a file drag would break ordinary in-page dragging, and failing to intercept
 * one that is lets the browser navigate to the dropped file, destroying the session.
 *
 * MUST ACCEPT                                    | MUST REJECT
 * -----------------------------------------------|------------------------------------------
 * an OS file drag       ['Files']                 | dragged text      ['text/plain']
 * files + their names   ['Files','text/plain']    | a dragged link    ['text/uri-list', ...]
 * files under any case  ['files']                 | an in-page element drag ['application/x-happy']
 *                                                 | a drag with no types at all  []
 *
 * [LAW:types-are-the-program] The signature takes the type list rather than a
 * DataTransfer, because the list is the entire input the question depends on. That is
 * what makes this the one part of the drop path testable without a browser.
 *
 * The check is deliberately `types`, not `files`. Browsers withhold `dataTransfer.files`
 * until the `drop` event — during `dragenter`/`dragover` it is always empty — so a
 * `files.length` test reads as false at exactly the moment we must call preventDefault
 * to make the drop possible at all. `types` is populated throughout the drag.
 */
export function dragCarriesFiles(types: readonly string[] | undefined | null): boolean {
    if (!types) return false;
    // Safari has historically reported 'files' in lowercase; the spec says 'Files'.
    return types.some((type) => type.toLowerCase() === 'files');
}

/**
 * Keeps the drag overlay steady while the pointer moves across the page.
 *
 * [LAW:no-ambient-temporal-coupling] `dragenter`/`dragleave` fire as a *pair* every time
 * the pointer crosses into a child element, so "hide on dragleave" flickers the overlay
 * off and on for every nested view the pointer touches. Depth is the state that makes
 * the answer independent of that incidental ordering: the drag has truly left only when
 * as many leaves have arrived as enters.
 */
export class DragDepth {
    private depth = 0;

    /** @returns whether a drag is now over the page. */
    enter(): boolean {
        this.depth++;
        return true;
    }

    /** @returns whether a drag is still over the page. */
    leave(): boolean {
        this.depth = Math.max(0, this.depth - 1);
        return this.depth > 0;
    }

    /** A drop or a cancelled drag ends the drag outright, however deep we were. */
    reset(): void {
        this.depth = 0;
    }
}
