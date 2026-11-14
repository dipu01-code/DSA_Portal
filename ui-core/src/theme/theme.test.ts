import { describe, expect, it } from 'vitest';
import { contrastRatio, toCssVars, tokens } from './index';

describe('design tokens', () => {
  it.each(['light', 'dark'] as const)(
    '%s text colours meet WCAG AA (4.5:1) on bg and surface',
    (mode) => {
      const c = tokens.color[mode];
      for (const fg of [c.text, c.textMuted, c.primary, c.success, c.danger, c.warning]) {
        for (const bg of [c.bg, c.surface, c.surfaceRaised]) {
          expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(contrastRatio(c.onPrimary, c.primary)).toBeGreaterThanOrEqual(4.5);
    }
  );
  it('light and dark define the same colour names', () => {
    expect(Object.keys(tokens.color.dark).sort()).toEqual(Object.keys(tokens.color.light).sort());
  });
  it('turns tokens into CSS variables', () => {
    expect(toCssVars('dark')).toMatchObject({
      '--color-bg': '#0f1420',
      '--space-md': '12px',
      '--font-sm': '14px',
    });
  });
});
