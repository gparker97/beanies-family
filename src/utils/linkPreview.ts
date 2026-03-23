export interface LinkPreview {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

/**
 * Fetch Open Graph metadata from a URL via Microlink API.
 * Free tier: 50 requests/day — sufficient for saving idea links.
 * Returns partial data on success, null if the fetch fails.
 */
export async function fetchLinkPreview(url: string): Promise<LinkPreview | null> {
  try {
    const encoded = encodeURIComponent(url);
    const response = await fetch(`https://api.microlink.io?url=${encoded}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;

    const json = await response.json();
    if (json.status !== 'success' || !json.data) return null;

    const d = json.data;
    const preview: LinkPreview = {};
    if (d.title) preview.title = d.title;
    if (d.description) preview.description = d.description;
    if (d.image?.url) preview.image = d.image.url;
    if (d.publisher) preview.siteName = d.publisher;

    if (preview.title || preview.description) {
      return preview;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract the domain name from a URL for display.
 */
export function extractDomain(url: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
