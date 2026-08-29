export interface NoticeConfig {
  version: string;
  title: string;
  body: string | string[];
  changelog: string[];
  thanks?: string;
}

const NOTICE_VERSION = '1.2.1';

export const NOTICE: NoticeConfig = {
  version: NOTICE_VERSION,
  title: `Update ${NOTICE_VERSION}`,
  body: [
    'Hi guys, this is a small update to the app. Hope you enjoy it.',
  ],
  changelog: [
    'https://discord.gg/BqC4JzwT join my discord channel to give me feedback and suggestions.',
  ],
  thanks: 'Thanks for using the app. I hope you enjoy it.',
};

export function shouldShowNotice(
  storedRaw: string | null,
  currentVersion: string,
): boolean {
  if (storedRaw === null) {
    return true;
  }

  const stored = parseVersionParts(storedRaw);
  const current = parseVersionParts(currentVersion);

  if (stored === null || current === null) {
    return true;
  }

  const length = Math.max(stored.length, current.length);

  for (let index = 0; index < length; index += 1) {
    const storedPart = stored[index] ?? 0;
    const currentPart = current[index] ?? 0;

    if (storedPart !== currentPart) {
      return storedPart < currentPart;
    }
  }

  return false;
}

function parseVersionParts(version: string): number[] | null {
  if (!/^\d+(\.\d+)*$/.test(version)) {
    return null;
  }

  return version.split('.').map((part) => Number(part));
}
