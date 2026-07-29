import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.hoisted(() => vi.fn());
const network = vi.hoisted(() => ({
  fetch: vi.fn(),
  agents: [] as Array<{
    options: {
      connect: {
        lookup: (
          hostname: string,
          options: { all?: boolean; family?: number },
          callback: (...args: unknown[]) => void,
        ) => void;
      };
    };
    close: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));
vi.mock("undici", () => ({
  fetch: network.fetch,
  Agent: vi.fn(function MockAgent(options: (typeof network.agents)[number]["options"]) {
    const close = vi.fn(async () => undefined);
    network.agents.push({ options, close });
    return { close };
  }),
}));

import {
  FETCH_SOURCE_MAX_BYTES,
  FETCH_SOURCE_MAX_URL_CHARS,
  fetchSourceReal,
  readBoundedFetchBody,
  resolvePublicFetchHost,
} from "../src/nodeagent/skills/search/fetchSource";

const PUBLIC_DNS_ANSWER = [{ address: "93.184.216.34", family: 4 }];

describe("fetch_source hardened production scenarios", () => {
  beforeEach(() => {
    lookupMock.mockReset();
    network.fetch.mockReset();
    network.agents.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("blocks localtest.me after DNS resolution and never opens a request", async () => {
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);

    const result = await fetchSourceReal("https://localtest.me/private");

    expect(result).toEqual({ ok: false, error: "blocked_private_or_reserved_ip" });
    expect(lookupMock).toHaveBeenCalledExactlyOnceWith("localtest.me", {
      all: true,
      verbatim: true,
    });
    expect(network.fetch).not.toHaveBeenCalled();
  });

  it("rejects embedded URL credentials before DNS or network access", async () => {
    const result = await fetchSourceReal("https://user:secret@public.example/source");

    expect(result).toEqual({ ok: false, error: "url_credentials_forbidden" });
    expect(lookupMock).not.toHaveBeenCalled();
    expect(network.fetch).not.toHaveBeenCalled();
  });

  it("rejects an oversized attacker-controlled URL before parsing, DNS, or network access", async () => {
    const result = await fetchSourceReal(
      `https://public.example/${"a".repeat(FETCH_SOURCE_MAX_URL_CHARS)}`,
    );

    expect(result).toEqual({ ok: false, error: "invalid_url" });
    expect(lookupMock).not.toHaveBeenCalled();
    expect(network.fetch).not.toHaveBeenCalled();
  });

  it("rechecks the canonical URL length after Unicode percent-encoding expands the input", async () => {
    const raw = `https://public.example/${"é".repeat(340)}`;
    expect(raw.length).toBeLessThan(FETCH_SOURCE_MAX_URL_CHARS);
    expect(new URL(raw).toString().length).toBeGreaterThan(FETCH_SOURCE_MAX_URL_CHARS);

    const result = await fetchSourceReal(raw);

    expect(result).toEqual({ ok: false, error: "invalid_url" });
    expect(lookupMock).not.toHaveBeenCalled();
    expect(network.fetch).not.toHaveBeenCalled();
  });

  it.each([
    "https://10.0.0.8/",
    "https://127.0.0.1/",
    "https://169.254.169.254/latest/meta-data/",
    "https://203.0.113.8/",
    "https://[fe90::1]/",
    "https://[fec0::1]/",
    "https://[ff02::1]/",
  ])("blocks direct private, link-local, multicast, or reserved target %s", async (url) => {
    const result = await fetchSourceReal(url);

    expect(result).toEqual({ ok: false, error: "blocked_private_or_reserved_ip" });
    expect(lookupMock).not.toHaveBeenCalled();
    expect(network.fetch).not.toHaveBeenCalled();
  });

  it("pins the request socket to the prevalidated answer even if later DNS would rebind", async () => {
    lookupMock
      .mockResolvedValueOnce(PUBLIC_DNS_ANSWER)
      .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    let pinnedLookupResult: unknown[] = [];
    network.fetch.mockImplementation(async () => {
      const lookup = network.agents.at(-1)?.options.connect.lookup;
      lookup?.("rebind.example", { all: true }, (...args) => {
        pinnedLookupResult = args;
      });
      return new Response("<title>Public</title><body>Evidence</body>", { status: 200 });
    });

    const result = await fetchSourceReal("https://rebind.example/source");

    expect(result).toMatchObject({ ok: true, title: "Public" });
    expect(lookupMock).toHaveBeenCalledTimes(1);
    expect(pinnedLookupResult[0]).toBeNull();
    expect(pinnedLookupResult[1]).toEqual(PUBLIC_DNS_ANSWER);
  });

  it("hands the trusted adapter the exact bounded response bytes while keeping receipt material out of SourceResult", async () => {
    lookupMock.mockResolvedValue(PUBLIC_DNS_ANSWER);
    const body = "<title>Public</title><body>Exact evidence bytes</body>";
    network.fetch.mockResolvedValue(new Response(body, { status: 200 }));
    const captures: Array<{
      source: { title: string; snippet: string; url: string };
      exactBytes: Uint8Array;
      verifiedAt: number;
    }> = [];

    const result = await fetchSourceReal(
      "https://public.example/source",
      (capture) => {
        captures.push(capture);
        return true;
      },
    );

    expect(result).toEqual({
      ok: true,
      title: "Public",
      snippet: "Public Exact evidence bytes",
      url: "https://public.example/source",
      provenance: "network_fetch",
    });
    expect(result).not.toHaveProperty("contentDigest");
    expect(result).not.toHaveProperty("verifiedAt");
    expect(captures).toHaveLength(1);
    expect(new TextDecoder().decode(captures[0].exactBytes)).toBe(body);
    expect(captures[0].source).toEqual(result);
  });

  it("re-resolves every redirect hop and rejects a private second-hop answer", async () => {
    lookupMock
      .mockResolvedValueOnce(PUBLIC_DNS_ANSWER)
      .mockResolvedValueOnce([{ address: "192.168.1.9", family: 4 }]);
    network.fetch.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://private-hop.example/secret" },
      }),
    );

    const result = await fetchSourceReal("https://public-hop.example/start");

    expect(result).toEqual({ ok: false, error: "blocked_private_or_reserved_ip" });
    expect(lookupMock).toHaveBeenNthCalledWith(1, "public-hop.example", {
      all: true,
      verbatim: true,
    });
    expect(lookupMock).toHaveBeenNthCalledWith(2, "private-hop.example", {
      all: true,
      verbatim: true,
    });
    expect(network.fetch).toHaveBeenCalledTimes(1);
    expect(network.agents).toHaveLength(1);
    expect(network.agents[0].close).toHaveBeenCalledOnce();
  });

  it("rejects an oversized redirect target before the next DNS lookup", async () => {
    lookupMock.mockResolvedValueOnce(PUBLIC_DNS_ANSWER);
    network.fetch.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: {
          location: `https://redirect.example/${"a".repeat(FETCH_SOURCE_MAX_URL_CHARS)}`,
        },
      }),
    );

    const result = await fetchSourceReal("https://public-hop.example/start");

    expect(result).toEqual({ ok: false, error: "invalid_redirect_url" });
    expect(lookupMock).toHaveBeenCalledTimes(1);
    expect(network.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 429])("reports HTTP %s as an honest tool failure", async (status) => {
    lookupMock.mockResolvedValue(PUBLIC_DNS_ANSWER);
    network.fetch.mockResolvedValue(new Response("protected", { status }));

    const result = await fetchSourceReal("https://public.example/protected");

    expect(result).toEqual({ ok: false, error: `http_${status}` });
    expect(network.agents[0].close).toHaveBeenCalledOnce();
  });

  it("rejects an oversized declared body without calling text or arrayBuffer", async () => {
    const response = new Response("small placeholder", {
      headers: { "content-length": String(FETCH_SOURCE_MAX_BYTES + 1) },
    });
    const textSpy = vi.spyOn(response, "text");
    const arrayBufferSpy = vi.spyOn(response, "arrayBuffer");

    const result = await readBoundedFetchBody(response);

    expect(result).toEqual({ ok: false, error: "response_too_large" });
    expect(textSpy).not.toHaveBeenCalled();
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });

  it("rejects an oversized chunked body as soon as the byte budget is crossed", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(150_000));
        controller.enqueue(new Uint8Array(50_001));
        controller.enqueue(new Uint8Array(10_000));
        controller.close();
      },
    });

    const result = await readBoundedFetchBody(new Response(stream));

    expect(result).toEqual({ ok: false, error: "response_too_large" });
  });

  it("bounds sustained empty-chunk streams instead of spinning until memory or CPU exhaustion", async () => {
    let reads = 0;
    const result = await readBoundedFetchBody({
      headers: { get: () => null },
      body: {
        getReader: () => ({
          read: async () => {
            reads += 1;
            return { done: false, value: new Uint8Array() };
          },
          cancel: async () => undefined,
          releaseLock: () => undefined,
        }),
        cancel: async () => undefined,
      },
    });

    expect(result).toEqual({ ok: false, error: "response_too_large" });
    expect(reads).toBe(1_025);
  });

  it("returns timeout when DNS consumes the one total request budget", async () => {
    vi.useFakeTimers();
    lookupMock.mockReturnValue(new Promise(() => undefined));

    const pending = fetchSourceReal("https://slow-dns.example/source");
    await vi.advanceTimersByTimeAsync(5_001);

    await expect(pending).resolves.toEqual({ ok: false, error: "timeout" });
    expect(network.fetch).not.toHaveBeenCalled();
  });

  it("keeps resolver and dispatcher state isolated across burst and sustained waves", async () => {
    lookupMock.mockResolvedValue(PUBLIC_DNS_ANSWER);
    network.fetch.mockImplementation(async () =>
      new Response("<title>Stable</title><body>bounded evidence</body>", { status: 200 }),
    );

    for (let wave = 0; wave < 4; wave += 1) {
      const results = await Promise.all(
        Array.from({ length: 16 }, (_, index) =>
          fetchSourceReal(`https://source-${wave}-${index}.example/evidence`),
        ),
      );
      expect(results.every((result) => result.ok)).toBe(true);
    }

    expect(lookupMock).toHaveBeenCalledTimes(64);
    expect(network.fetch).toHaveBeenCalledTimes(64);
    expect(network.agents).toHaveLength(64);
    expect(network.agents.every(({ close }) => close.mock.calls.length === 1)).toBe(true);
  });

  it("exposes a deterministic resolver seam for mixed-answer rejection", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);

    await expect(
      resolvePublicFetchHost("mixed-answer.example", new AbortController().signal),
    ).resolves.toEqual({ ok: false, error: "blocked_private_or_reserved_ip" });
  });
});
