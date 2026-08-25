import { defineConfig } from 'vitest/config'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Anchored to this file, not to the working directory. `resolve('./sources')` silently pointed at
// <cwd>/sources, so running vitest from the repo root instead of the package directory resolved the
// '@' alias to a path that does not exist — and the failure surfaced as "Cannot find package
// '@/utils/...'", which reads like a missing module rather than a broken alias.
const packageRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
    test: {
        globals: false,
        environment: 'node',
        include: ['sources/**/*.{spec,test}.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: [
                'node_modules/**',
                'dist/**',
                '**/*.d.ts',
                '**/*.config.*',
                '**/mockData/**',
            ],
        },
    },
    resolve: {
        alias: {
            '@': resolve(packageRoot, './sources'),
        },
    },
})