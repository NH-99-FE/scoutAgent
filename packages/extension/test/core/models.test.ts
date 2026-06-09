import { describe, expect, it } from 'vitest';
import { ScoutModelRegistry } from '../../src/core/model-registry.ts';
import { ScoutModelResolver } from '../../src/core/model-resolver.ts';
import { mockModel } from './test-utils.ts';

describe('ScoutModelRegistry', () => {
  it('filters available models by configured provider API key', () => {
    const registry = new ScoutModelRegistry({ hasApiKey: (provider) => provider === 'openai' });

    expect(registry.getAvailableModels().every((entry) => entry.provider === 'openai')).toBe(true);
  });

  it('allows project custom models to override built-in ids', () => {
    const registry = new ScoutModelRegistry({ hasApiKey: () => true });
    registry.setCustomModels([
      mockModel({
        provider: 'anthropic',
        id: 'custom-claude',
        name: 'Custom Claude',
      }),
    ]);

    expect(registry.getModel('anthropic', 'custom-claude')?.name).toBe('Custom Claude');
  });
});

describe('ScoutModelResolver', () => {
  it('resolves scoped provider/model references before loose model ids', () => {
    const registry = new ScoutModelRegistry({ hasApiKey: () => true });
    registry.setCustomModels([
      mockModel({ provider: 'openai', id: 'same-id', name: 'OpenAI Same' }),
      mockModel({ provider: 'anthropic', id: 'same-id', name: 'Anthropic Same' }),
    ]);
    const resolver = new ScoutModelResolver(registry);

    expect(resolver.findModel('openai/same-id')?.provider).toBe('openai');
  });

  it('resolves references case-insensitively and strips thinking suffixes', () => {
    const registry = new ScoutModelRegistry({ hasApiKey: () => true });
    registry.setCustomModels([
      mockModel({ provider: 'anthropic', id: 'claude-custom', name: 'Claude Custom' }),
    ]);
    const resolver = new ScoutModelResolver(registry);

    expect(resolver.findModel('ANTHROPIC/CLAUDE-CUSTOM:high')?.id).toBe('claude-custom');
    expect(resolver.findModel('custom')?.id).toBe('claude-custom');
  });

  it('falls back with a warning when configured default auth is missing', () => {
    const registry = new ScoutModelRegistry({ hasApiKey: (provider) => provider === 'openai' });
    registry.setCustomModels([
      mockModel({ provider: 'anthropic', id: 'private-anthropic' }),
      mockModel({ provider: 'openai', id: 'available-openai' }),
    ]);
    const resolver = new ScoutModelResolver(registry);

    const resolution = resolver.resolveDefaultModel('anthropic/private-anthropic');

    expect(resolution.model?.provider).toBe('openai');
    expect(resolution.warning).toContain('has no configured API key');
  });
});
