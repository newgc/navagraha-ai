import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://u:p@h/db' })).toEqual({
      NODE_ENV: 'development',
      API_PORT: 4000,
      DATABASE_URL: 'postgres://u:p@h/db',
    });
  });

  it('fails fast listing every bad variable', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x', API_PORT: 'abc' })).toThrow(
      /DATABASE_URL.*API_PORT|API_PORT.*DATABASE_URL/,
    );
  });
});
