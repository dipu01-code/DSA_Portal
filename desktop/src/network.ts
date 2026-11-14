import { net } from 'electron';

/**
 * "Online" means the API answers, not just that a network interface is up (a captive portal or a
 * down server counts as offline). Re-checked every `pollMs`; listeners hear only changes.
 */
export function watchNetwork(
  apiBaseUrl: string,
  pollMs: number,
  onChange: (online: boolean) => void
) {
  let online = false;
  let timer: NodeJS.Timeout | undefined;
  async function check() {
    let now = false;
    if (net.isOnline()) {
      try {
        const res = await fetch(`${apiBaseUrl}/api/v1/health`, {
          signal: AbortSignal.timeout(2000),
        });
        now = res.ok;
      } catch {
        now = false;
      }
    }
    if (now !== online) {
      online = now;
      onChange(online);
    }
  }
  const loop = async () => {
    await check();
    timer = setTimeout(loop, pollMs);
  };
  const ready = check().then(() => void (timer = setTimeout(loop, pollMs)));
  return {
    ready,
    isOnline: () => online,
    stop: () => clearTimeout(timer),
  };
}
