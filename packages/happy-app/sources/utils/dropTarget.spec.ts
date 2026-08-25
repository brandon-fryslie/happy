import { describe, it, expect } from 'vitest';
import { dragCarriesFiles, DragDepth } from './dropTarget';

// The table in dropTarget.ts, executable. Each reject row perturbs one thing about a
// real file drag while holding the rest, which is what a body written against the happy
// path alone would let through.
describe('dragCarriesFiles', () => {
    it.each([
        ['a bare file drag', ['Files']],
        ['files alongside their names', ['Files', 'text/plain']],
        ['Safari lowercase', ['files']],
        ['files last in the list', ['text/uri-list', 'Files']],
    ])('accepts %s', (_label, types) => {
        expect(dragCarriesFiles(types)).toBe(true);
    });

    it.each([
        ['dragged text', ['text/plain']],
        ['a dragged link', ['text/uri-list', 'text/plain', 'text/html']],
        ['an in-page element drag', ['application/x-happy']],
        ['a type that merely contains the word', ['my-Files-list']],
        ['no types at all', []],
    ])('rejects %s', (_label, types) => {
        expect(dragCarriesFiles(types)).toBe(false);
    });

    it('rejects a missing type list rather than throwing', () => {
        expect(dragCarriesFiles(undefined)).toBe(false);
        expect(dragCarriesFiles(null)).toBe(false);
    });
});

describe('DragDepth', () => {
    it('stays active while the pointer crosses into nested children', () => {
        const depth = new DragDepth();
        expect(depth.enter()).toBe(true);   // onto the page
        expect(depth.enter()).toBe(true);   // onto a child
        expect(depth.leave()).toBe(true);   // off the parent, still on the child
        expect(depth.leave()).toBe(false);  // off the page for real
    });

    it('ends the drag on reset however deep the pointer went', () => {
        const depth = new DragDepth();
        depth.enter();
        depth.enter();
        depth.reset();
        expect(depth.leave()).toBe(false);
    });

    it('never goes negative when a stray leave arrives first', () => {
        // Browsers do emit an unpaired dragleave when a drag is cancelled with Escape.
        // Without the clamp, the count goes to -1 and the *next* real drag needs two
        // enters before the overlay appears.
        const depth = new DragDepth();
        expect(depth.leave()).toBe(false);
        expect(depth.enter()).toBe(true);
        expect(depth.leave()).toBe(false);
    });
});
