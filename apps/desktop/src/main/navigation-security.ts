function normalizeOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.origin;
  } catch {
    return null;
  }
}

export function isAllowedRendererNavigation(targetUrl: string, devServerUrl?: string): boolean {
  if (!targetUrl) {
    return false;
  }

  try {
    const parsedTarget = new URL(targetUrl);
    if (parsedTarget.protocol === "about:") {
      return parsedTarget.href === "about:blank";
    }
    if (parsedTarget.protocol === "file:") {
      return true;
    }

    if (!devServerUrl) {
      return false;
    }

    const devOrigin = normalizeOrigin(devServerUrl);
    if (!devOrigin) {
      return false;
    }

    return parsedTarget.origin === devOrigin && (parsedTarget.protocol === "http:" || parsedTarget.protocol === "https:");
  } catch {
    return false;
  }
}
