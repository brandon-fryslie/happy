/**
 * Adds a tap-feedback label flip to the LogBox notification's Copy button:
 * pressing it changes the label to "Copied!" for ~1.5s, then reverts.
 *
 * Composes on top of `logbox-notification-copy-button.cjs` — that patch
 * inserts the Copy button; this one teaches it to acknowledge the press.
 *
 * Touches one file in node_modules/react-native:
 *   LogBoxNotification.js — adds useState import, state declaration, and
 *                           wires setCopied + setTimeout into the onPress.
 *
 * [LAW:scripting-discipline] Validate every patch site and fail loudly if
 * a marker is missing.
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const FILE = 'node_modules/react-native/Libraries/LogBox/UI/LogBoxNotification.js';

const sites = [
    {
        name: 'useState import',
        marker: "import {useEffect} from 'react';",
        replacement: "import {useEffect, useState} from 'react';",
    },
    {
        name: 'copied state declaration',
        marker:
            '  useEffect(() => {\n' +
            '    LogBoxData.symbolicateLogLazy(log);\n' +
            '  }, [log]);\n' +
            '\n' +
            '  return (',
        replacement:
            '  useEffect(() => {\n' +
            '    LogBoxData.symbolicateLogLazy(log);\n' +
            '  }, [log]);\n' +
            '\n' +
            '  const [copied, setCopied] = useState(false);\n' +
            '\n' +
            '  return (',
    },
    {
        name: 'onPress + label feedback',
        marker:
            "                require('expo-clipboard').setStringAsync(text);\n" +
            '              }}\n' +
            "              style={{height: 20, paddingHorizontal: 8, borderRadius: 10, alignItems: 'center', justifyContent: 'center'}}>\n" +
            "              <Text style={{color: LogBoxStyle.getBackgroundColor(1), fontSize: 12, fontWeight: '600', lineHeight: 20}}>Copy</Text>",
        replacement:
            "                require('expo-clipboard').setStringAsync(text);\n" +
            '                setCopied(true);\n' +
            '                setTimeout(() => setCopied(false), 1500);\n' +
            '              }}\n' +
            "              style={{height: 20, paddingHorizontal: 8, borderRadius: 10, alignItems: 'center', justifyContent: 'center'}}>\n" +
            "              <Text style={{color: LogBoxStyle.getBackgroundColor(1), fontSize: 12, fontWeight: '600', lineHeight: 20}}>{copied ? 'Copied!' : 'Copy'}</Text>",
    },
];

const abs = path.join(repoRoot, FILE);
if (!fs.existsSync(abs)) {
    console.error('[logbox-notification-copy-feedback] FAILED: file not found: ' + FILE);
    process.exit(1);
}

let contents = fs.readFileSync(abs, 'utf8');
let patched = 0;
let alreadyPatched = 0;
const missing = [];

for (const site of sites) {
    if (contents.includes(site.replacement)) {
        alreadyPatched++;
        continue;
    }
    if (!contents.includes(site.marker)) {
        missing.push(site.name);
        continue;
    }
    contents = contents.replace(site.marker, site.replacement);
    patched++;
}

if (missing.length > 0) {
    console.error('[logbox-notification-copy-feedback] FAILED to apply patch:');
    for (const m of missing) console.error('  - missing marker for site: ' + m);
    console.error('  Did logbox-notification-copy-button.cjs run first?');
    process.exit(1);
}

fs.writeFileSync(abs, contents, 'utf8');
console.log(`[logbox-notification-copy-feedback] patched ${patched} site(s), ${alreadyPatched} already patched`);
