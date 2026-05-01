/**
 * Adds a third "Copy" footer button to React Native's LogBox inspector,
 * sitting between the existing "Dismiss" and "Minimize" buttons. Pressing
 * it copies the error message + symbolicated stacktrace to the clipboard.
 *
 * Touches two files in node_modules/react-native:
 *   1. LogBoxInspectorFooter.js — render the button, take an onCopy prop.
 *   2. LogBoxInspector.js       — wire onCopy: format text, call Clipboard.
 *
 * Clipboard is loaded via lazy `require('expo-clipboard')` inside the press
 * handler so LogBox keeps its existing import surface unchanged.
 *
 * [LAW:scripting-discipline] Validate every patch site and fail loudly if a
 * marker is missing. RN ships these files differently across SDKs and a
 * silent no-op would leave the button broken with no signal at install time.
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

const FOOTER_MARKER =
    '        onPress={props.onDismiss}\n' +
    '      />\n' +
    '      <LogBoxInspectorFooterButton\n' +
    '        id="logbox_footer_button_minimize"';

const FOOTER_REPLACEMENT =
    '        onPress={props.onDismiss}\n' +
    '      />\n' +
    '      <LogBoxInspectorFooterButton\n' +
    '        id="logbox_footer_button_copy"\n' +
    '        text="Copy"\n' +
    '        onPress={props.onCopy}\n' +
    '      />\n' +
    '      <LogBoxInspectorFooterButton\n' +
    '        id="logbox_footer_button_minimize"';

const INSPECTOR_MARKER =
    '      <LogBoxInspectorFooter\n' +
    '        onDismiss={props.onDismiss}\n' +
    '        onMinimize={props.onMinimize}\n' +
    '        level={log.level}\n' +
    '      />';

const INSPECTOR_REPLACEMENT =
    '      <LogBoxInspectorFooter\n' +
    '        onDismiss={props.onDismiss}\n' +
    '        onMinimize={props.onMinimize}\n' +
    '        onCopy={() => {\n' +
    '          const stack = log.getAvailableStack() || log.stack || [];\n' +
    '          const stackText = stack\n' +
    '            .map(f => {\n' +
    '              const file = f.file || \'\';\n' +
    '              const line = f.lineNumber != null ? \':\' + f.lineNumber : \'\';\n' +
    '              const col = f.column != null ? \':\' + f.column : \'\';\n' +
    '              const loc = file ? \' (\' + file + line + col + \')\' : \'\';\n' +
    '              return (f.methodName || \'<anonymous>\') + loc;\n' +
    '            })\n' +
    '            .join(\'\\n\');\n' +
    '          const message = (log.message && log.message.content) || \'\';\n' +
    '          const text = message + (stackText ? \'\\n\\n\' + stackText : \'\');\n' +
    '          require(\'expo-clipboard\').setStringAsync(text);\n' +
    '        }}\n' +
    '        level={log.level}\n' +
    '      />';

const targets = [
    {
        relPath: 'node_modules/react-native/Libraries/LogBox/UI/LogBoxInspectorFooter.js',
        marker: FOOTER_MARKER,
        replacement: FOOTER_REPLACEMENT,
    },
    {
        relPath: 'node_modules/react-native/Libraries/LogBox/UI/LogBoxInspector.js',
        marker: INSPECTOR_MARKER,
        replacement: INSPECTOR_REPLACEMENT,
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
        missing.push(`marker not found in ${t.relPath}`);
        continue;
    }
    const next = original.replace(t.marker, t.replacement);
    fs.writeFileSync(abs, next, 'utf8');
    patched++;
}

if (missing.length > 0) {
    console.error('[logbox-copy-button] FAILED to apply patch:');
    for (const m of missing) console.error('  - ' + m);
    console.error('  React Native LogBox internals may have changed; update patches/logbox-copy-button.cjs.');
    process.exit(1);
}

console.log(`[logbox-copy-button] patched ${patched} file(s), ${alreadyPatched} already patched`);
