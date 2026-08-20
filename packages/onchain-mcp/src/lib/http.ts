// fetch that names the target on network failure, instead of undici's bare
// "fetch failed" whose cause (ECONNREFUSED, ENOTFOUND, ...) is otherwise dropped.
export async function fetchNamed(what: string, url: string | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    const cause = (e as { cause?: { code?: string; message?: string } })?.cause;
    const detail = cause?.code ?? cause?.message ?? (e instanceof Error ? e.message : String(e));
    throw new Error(`${what} unreachable at ${new URL(url).host}: ${detail}`);
  }
}
