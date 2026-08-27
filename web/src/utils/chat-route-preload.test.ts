import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { shouldPreloadChatRoute } from './chat-route-preload';

describe('chat route preload policy', () => {
  test.each([
    ['/', '', '/', true],
    ['/chat', '', '/', true],
    ['/chat/workspace', '', '/', true],
    ['/tinycode/', '', '/tinycode/', true],
    ['/tinycode/chat/workspace', '', '/tinycode/', true],
    ['/tinycode/', '#/chat/workspace?agent=one', '/tinycode/', true],
    ['/login', '', '/', false],
    ['/register', '', '/', false],
    ['/setup/providers', '', '/', false],
    ['/tasks', '', '/', false],
    ['/memory', '', '/', false],
    ['/tinycode/tasks', '', '/tinycode/', false],
    ['/tinycode/', '#/memory', '/tinycode/', false],
    ['/chatty', '', '/', false],
  ])('pathname=%s hash=%s base=%s => %s', (pathname, hash, base, expected) => {
    expect(shouldPreloadChatRoute(pathname, hash, base)).toBe(expected);
  });

  test('keeps production HTML route-neutral and starts the chat split from the route policy', () => {
    const app = fs.readFileSync(
      path.join(process.cwd(), 'web/src/App.tsx'),
      'utf8',
    );
    const viteConfig = fs.readFileSync(
      path.join(process.cwd(), 'web/vite.config.ts'),
      'utf8',
    );

    expect(viteConfig).not.toContain('modulepreload');
    expect(viteConfig).not.toContain('preloadChatChunks');
    expect(app).toContain('shouldPreloadChatRoute(');
    expect(app).toContain('void loadChatPage();');
  });
});
