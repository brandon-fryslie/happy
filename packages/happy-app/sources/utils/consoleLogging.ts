/**
 * Console logging bootstrap for React Native
 *
 * Control flow:
 *
 * console.log("msg", obj)
 * │
 * ├─ consoleOutputEnabled = false? (default for prod)
 * │  └─ return immediately ⛔  (zero cost, args untouched)
 * │
 * ├─ consoleOutputEnabled = true? (default for dev/preview, or toggled on)
 * │  ├─ call original console method ✅
 * │  ├─ capture to in-app buffer ✅
 * │  └─ send to remote log server (if configured) ✅
 * │
 * └─ console.error / console.warn (always, regardless of flag)
 *    ├─ call original console method ✅
 *    ├─ capture to in-app buffer ✅
 *    └─ send to remote log server (if configured) ✅
 */

import { log } from '@/log';
import { MAX_APP_LOG_ENTRIES } from '@/log';
import { getLogServerUrl } from '@/sync/serverConfig';
import { loadLocalSettings } from '@/sync/persistence';
import { loadAppConfig } from '@/sync/appConfig';
import { Platform } from 'react-native';
import { serializeForLogs } from '@/utils/truncateForLogs';

let logBuffer: any[] = []
const MAX_BUFFER_SIZE = MAX_APP_LOG_ENTRIES
let isConsolePatched = false
let remoteLogServerUrl: string | null = null
let consoleOutputEnabled = false
// Whether the last remote-log POST reached the collector. Drives one-shot
// transition notices so an unreachable collector is visible rather than silent.
let remoteDeliveryHealthy = true
let originalConsole: {
  log: typeof console.log,
  info: typeof console.info,
  warn: typeof console.warn,
  error: typeof console.error,
  debug: typeof console.debug,
} | null = null

/**
 * Toggle console output at runtime (e.g. from Dev screen toggle).
 */
export function setConsoleOutputEnabled(enabled: boolean) {
  consoleOutputEnabled = enabled
}

export function initConsoleLogging() {
  if (isConsolePatched) {
    return
  }

  remoteLogServerUrl = getLogServerUrl();

  // Determine initial state: user setting > build variant default > off
  try {
    const settings = loadLocalSettings();
    const config = loadAppConfig();
    consoleOutputEnabled = settings.consoleLoggingEnabled || config.consoleLoggingDefault || false;
  } catch {
    consoleOutputEnabled = false;
  }

  originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  }

  log.setConsoleCaptureEnabled(true)

  function formatArgs(args: any[]): string {
    return args.map(a => {
      if (a === null || a === undefined) return String(a)
      if (typeof a !== 'object') return serializeForLogs(a)
      try { return serializeForLogs(a) } catch { return String(a) }
    }).join(' ')
  }

  // [LAW:no-silent-failure] Remote delivery health is reported as a state
  // transition, not per line. Reporting every failed POST would flood the very
  // console we are trying to read, and staying silent (the previous behaviour)
  // made an unreachable collector indistinguishable from an idle app - the
  // reader sees no logs either way and cannot tell which.
  //
  // The notice goes through originalConsole, never the patched console, because
  // the patched one calls back into sendLog and would recurse forever. It is
  // also pushed into the in-app buffer, since on a physical device the Dev
  // screen's log viewer is the only surface the user can actually read.
  function noteDeliveryState(message: string, level: 'error' | 'log') {
    originalConsole![level](message)
    const formatted = `[ConsoleLogging] ${message}`
    log.captureFormatted(level === 'error' ? 'error' : 'info', formatted)
    logBuffer.push({ timestamp: new Date().toISOString(), level, message: formatted })
    if (logBuffer.length > MAX_BUFFER_SIZE) {
      logBuffer.shift()
    }
  }

  function onDeliveryFailed(reason: string) {
    if (!remoteDeliveryHealthy) {
      return
    }
    remoteDeliveryHealthy = false
    noteDeliveryState(
      `Remote log delivery to ${remoteLogServerUrl} FAILED (${reason}). ` +
      `Logs are still captured in this in-app buffer. Check that the collector is ` +
      `running ("pnpm app-logs") and reachable from this device.`,
      'error'
    )
  }

  function onDeliverySucceeded() {
    if (remoteDeliveryHealthy) {
      return
    }
    remoteDeliveryHealthy = true
    noteDeliveryState(`Remote log delivery to ${remoteLogServerUrl} recovered.`, 'log')
  }

  function sendLog(level: string, formatted: string) {
    if (!remoteLogServerUrl) {
      return
    }

    void fetch(remoteLogServerUrl + '/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message: formatted,
        source: 'mobile',
        platform: Platform.OS,
      })
    }).then(res => {
      // A non-2xx is just as much a delivery failure as a thrown request; the
      // collector rejecting malformed payloads must not read as success.
      if (res.ok) {
        onDeliverySucceeded()
      } else {
        onDeliveryFailed(`HTTP ${res.status}`)
      }
    }).catch(e => onDeliveryFailed(String(e?.message ?? e)))
  }

  // Patch console methods
  ;(['log', 'info', 'warn', 'error', 'debug'] as const).forEach(level => {
    const alwaysPassThrough = level === 'error' || level === 'warn'

    console[level] = (...args: any[]) => {
      // Full short-circuit: when off, skip everything for log/info/debug
      if (!consoleOutputEnabled && !alwaysPassThrough) {
        return
      }

      // Pass raw args to native console (preserves interactive object inspection,
      // clickable stack traces, and multi-arg formatting in dev tools)
      originalConsole![level](...args)

      // Serialize once for buffer + remote (but NOT for native console)
      const formatted = formatArgs(args)
      log.captureFormatted(level, formatted)

      logBuffer.push({
        timestamp: new Date().toISOString(),
        level,
        message: formatted
      })
      if (logBuffer.length > MAX_BUFFER_SIZE) {
        logBuffer.shift()
      }

      sendLog(level, formatted)
    }
  })

  isConsolePatched = true

  originalConsole.log('[ConsoleLogging] Initialized', consoleOutputEnabled ? '(output enabled)' : '(output suppressed)')
}

// For developer settings UI
export function getLogBuffer() {
  return [...logBuffer]
}

export function clearLogBuffer() {
  logBuffer = []
}
