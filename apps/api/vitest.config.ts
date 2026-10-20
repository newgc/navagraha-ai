import { defineConfig } from 'vitest/config';

// DB suites share TEST_DATABASE_URL and reset its schema, so they must not run concurrently.
export default defineConfig({ test: { fileParallelism: false } });
