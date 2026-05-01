/**
 * Make text inside React Native's LogBox inspector selectable so devs can
 * copy error messages and code-frame contents on iOS / Android.
 *
 * Targets two bare `<Text>` parents that aren't wrapped in a Pressable:
 *   1. LogBoxInspectorMessageHeader.js — the actual error message body.
 *   2. AnsiHighlight.js                — the source code-frame contents.
 *
 * Stack-frame text is intentionally skipped because it's wrapped in a
 * LogBoxButton (long-press = open in editor); making it selectable would
 * fight the press handler.
 *
 * [LAW:scripting-discipline] Validate every patch site and fail loudly if a
 * marker is missing — silent no-ops here would pretend success while the
 * underlying RN files have shifted across SDK versions.
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

const targets = [
    {
        relPath: 'node_modules/react-native/Libraries/LogBox/UI/LogBoxInspectorMessageHeader.js',
        marker: '<Text style={messageStyles.bodyText} id="logbox_message_contents_text">',
        replacement: '<Text selectable={true} style={messageStyles.bodyText} id="logbox_message_contents_text">',
    },
    {
        relPath: 'node_modules/react-native/Libraries/LogBox/UI/AnsiHighlight.js',
        marker: '<Text style={styles.text}>',
        replacement: '<Text selectable={true} style={styles.text}>',
    },
];

let patched = 0;
let alreadyPatched = 0;
const missing = [];

for (const t of targets) {
    const abs = path.join(repoRoot, t.relPath);
    if (!fs.existsSync(abs)) {
        missing.push(`file not found: ${t.relPath}`);
        continue;
    }
    const original = fs.readFileSync(abs, 'utf8');
    if (original.includes(t.replacement)) {
        alreadyPatched++;
        continue;
    }
    if (!original.includes(t.marker)) {
        missing.push(`marker not found in ${t.relPath}: ${t.marker}`);
        continue;
    }
    const next = original.replace(t.marker, t.replacement);
    fs.writeFileSync(abs, next, 'utf8');
    patched++;
}

if (missing.length > 0) {
    console.error('[logbox-selectable-text] FAILED to apply patch:');
    for (const m of missing) console.error('  - ' + m);
    console.error('  React Native LogBox internals may have changed; update patches/logbox-selectable-text.cjs.');
    process.exit(1);
}

console.log(`[logbox-selectable-text] patched ${patched} file(s), ${alreadyPatched} already patched`);
