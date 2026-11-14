import { useColorScheme } from 'react-native';
import { tokens, useSettings } from '@dsa-portal/ui-core';

/** The same design tokens as web/desktop; numbers are density-independent pixels here. Follows Settings → Theme. */
export function useTheme() {
  const system = useColorScheme() === 'dark' ? 'dark' : 'light';
  const { theme } = useSettings();
  const mode = theme === 'system' ? system : theme;
  return {
    mode,
    c: tokens.color[mode],
    space: tokens.space,
    radius: tokens.radius,
    font: tokens.font,
  };
}

export const MONO = 'Menlo'; // iOS; Android maps unknown families to its default, so we pass 'monospace' there
