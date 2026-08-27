import { describe, it, expect } from 'vitest';
import { parseMarkdown, type MarkdownBlock, type MarkdownSpan } from './parseMarkdown';

// Table cells hold spans so inline markup survives inside them. Most tests here are
// about table *structure* — blank-line tolerance, empty cells, where collection stops —
// so they read the cell's text and let the dedicated span test below cover the markup.
const cellText = (cell: MarkdownSpan[]) => cell.map((span) => span.text).join('');

function onlyTable(blocks: MarkdownBlock[]): Extract<MarkdownBlock, { type: 'table' }> {
    const tables = blocks.filter((block) => block.type === 'table');
    expect(tables).toHaveLength(1);
    const table = tables[0];
    if (table.type !== 'table') throw new Error('Expected a markdown table block');
    return table;
}

describe('parseMarkdownBlock - table parsing', () => {

    it('parses a standard table without blank lines', () => {
        const md = [
            '| A | B |',
            '|---|---|',
            '| 1 | 2 |',
        ].join('\n');

        const blocks = parseMarkdown(md);
        expect(blocks).toHaveLength(1);

        const table = onlyTable(blocks);
        expect(table.headers.map(cellText)).toEqual(['A', 'B']);
        expect(table.rows.map((row) => row.map(cellText))).toEqual([['1', '2']]);
    });

    it('parses a table with blank lines between rows (LLM output)', () => {
        const md = [
            '| A | B |',
            '',
            '|---|---|',
            '',
            '| 1 | 2 |',
            '',
            '| 3 | 4 |',
        ].join('\n');

        // Should be recognized as a single table, not 4 separate text blocks
        const table = onlyTable(parseMarkdown(md));
        expect(table.headers.map(cellText)).toEqual(['A', 'B']);
        expect(table.rows.map((row) => row.map(cellText))).toEqual([['1', '2'], ['3', '4']]);
    });

    it('preserves empty interior cells (e.g. row header column)', () => {
        const md = [
            '| | Header1 | Header2 |',
            '|---|---|---|',
            '| Row1 | a | b |',
        ].join('\n');

        const blocks = parseMarkdown(md);
        expect(blocks).toHaveLength(1);

        const table = onlyTable(blocks);
        expect(table.headers.map(cellText)).toEqual(['', 'Header1', 'Header2']);
        expect(table.rows.map((row) => row.map(cellText))).toEqual([['Row1', 'a', 'b']]);
    });

    it('handles blank lines and empty first cell combined', () => {
        const md = [
            '### Comparison',
            '',
            '| | Plan A | Plan B |',
            '',
            '|--|----|----|',
            '',
            '| Price | $10/mo | $20/mo |',
            '',
            '| Storage | 5 GB | 50 GB |',
            '',
            '| Support | Email only | 24/7 chat |',
        ].join('\n');

        const table = onlyTable(parseMarkdown(md));

        // Empty first cell should be preserved
        expect(table.headers).toHaveLength(3);
        expect(cellText(table.headers[0])).toBe('');

        expect(table.rows).toHaveLength(3);
        expect(cellText(table.rows[0][0])).toBe('Price');
    });

    it('keeps inline markup inside cells rather than flattening it to text', () => {
        const md = [
            '| Name | Link |',
            '|---|---|',
            '| **bold** | [docs](https://example.com) |',
        ].join('\n');

        const table = onlyTable(parseMarkdown(md));

        expect(table.rows[0][0]).toEqual([{ styles: ['bold'], text: 'bold', url: null }]);
        expect(table.rows[0][1]).toEqual([{ styles: [], text: 'docs', url: 'https://example.com' }]);
    });

    it('stops table collection at non-blank, non-pipe lines', () => {
        const md = [
            '| A | B |',
            '|---|---|',
            '| 1 | 2 |',
            '',
            'Some text after the table',
        ].join('\n');

        const blocks = parseMarkdown(md);
        const textBlocks = blocks.filter(b => b.type === 'text');

        onlyTable(blocks);
        expect(textBlocks).toHaveLength(1);
    });
});
