/**
 * Adds a "Copy" button to React Native's minimized LogBox notification bar
 * (the strip at the bottom of the screen that shows when an error fires).
 * Pressing it copies the error message + symbolicated stacktrace to the
 * clipboard *without* expanding the inspector — RN's gesture responder
 * gives the inner pressable priority over the bar's open-on-press wrapper.
 *
 * Touches one file in node_modules/react-native:
 *   LogBoxNotification.js — adds Text import + button JSX between the
 *                           message and the existing dismiss button.
 *
 * Clipboard is loaded via lazy `require('expo-clipboard')` inside the
 * handler so the import surface of LogBox stays unchanged.
 *
 * [LAW:scripting-discipline] Validate every patch site and fail loudly if
 * a marker is missing — RN ships these files differently across SDK
 * versions and a silent no-op would leave the button missing with no
 * signal at install time.
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

const IMPORT_MARKER = "import View from '../../Components/View/View';";
const IMPORT_REPLACEMENT =
    "import View from '../../Components/View/View';\n" +
    "import Text from '../../Text/Text';";

const BUTTON_MARKER =
    '          <LogBoxNotificationMessage message={log.message} />\n' +
    '          <LogBoxNotificationDismissButton';

const BUTTON_REPLACEMENT =
    '          <LogBoxNotificationMessage message={log.message} />\n' +
    '          <View style={{alignSelf: \'center\', marginLeft: 5}}>\n' +
    '            <LogBoxButton\n' +
    '              id={`logbox_copy_button_${level}`}\n' +
    '              backgroundColor={{\n' +
    '                default: LogBoxStyle.getTextColor(0.3),\n' +
    '                pressed: LogBoxStyle.getTextColor(0.5),\n' +
    '              }}\n' +
    '              hitSlop={{top: 12, right: 8, bottom: 12, left: 8}}\n' +
    '              onPress={() => {\n' +
    '                const stack = log.getAvailableStack() || log.stack || [];\n' +
    '                const stackText = stack\n' +
    '                  .map(f => {\n' +
    '                    const file = f.file || \'\';\n' +
    '                    const line = f.lineNumber != null ? \':\' + f.lineNumber : \'\';\n' +
    '                    const col = f.column != null ? \':\' + f.column : \'\';\n' +
    '                    const loc = file ? \' (\' + file + line + col + \')\' : \'\';\n' +
    '                    return (f.methodName || \'<anonymous>\') + loc;\n' +
    '                  })\n' +
    '                  .join(\'\\n\');\n' +
    '                const message = (log.message && log.message.content) || \'\';\n' +
    '                const text = message + (stackText ? \'\\n\\n\' + stackText : \'\');\n' +
    '                require(\'expo-clipboard\').setStringAsync(text);\n' +
    '              }}\n' +
    '              style={{height: 20, paddingHorizontal: 8, borderRadius: 10, alignItems: \'center\', justifyContent: \'center\'}}>\n' +
    '              <Text style={{color: LogBoxStyle.getBackgroundColor(1), fontSize: 12, fontWeight: \'600\', lineHeight: 20}}>Copy</Text>\n' +
    '            </LogBoxButton>\n' +
    '          </View>\n' +
    '          <LogBoxNotificationDismissButton';

const targets = [
    {
        relPath: 'node_modules/react-native/Libraries/LogBox/UI/LogBoxNotification.js',
        marker: IMPORT_MARKER,
        replacement: IMPORT_REPLACEMENT,
    },
    {
        relPath: 'node_modules/react-native/Libraries/LogBox/UI/LogBoxNotification.js',
        marker: BUTTON_MARKER,
        replacement: BUTTON_REPLACEMENT,
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
    if (original.includes(t.replacement) || original.includes('logbox_copy_button_')) {
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
    console.error('[logbox-notification-copy-button] FAILED to apply patch:');
    for (const m of missing) console.error('  - ' + m);
    console.error('  React Native LogBox internals may have changed; update patches/logbox-notification-copy-button.cjs.');
    process.exit(1);
}

console.log(`[logbox-notification-copy-button] patched ${patched} site(s), ${alreadyPatched} already patched`);
