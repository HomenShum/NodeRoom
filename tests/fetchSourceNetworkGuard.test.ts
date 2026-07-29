import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.hoisted(() => vi.fn());
const undiciMocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  Agent: vi.fn(function MockAgent(_options: unknown) {
    return { close: vi.fn(async () => undefined) };
  }),
}));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));
vi.mock("undici", () => ({ Agent: undiciMocks.Agent, fetch: undiciMocks.fetch }));

async function fetchSourceReal() {
  return (await import("../src/nodeagent/skills/search/fetchSource")).fetchSourceReal;
}

describe("fetch_source network guard", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    lookupMock.mockReset();
    undiciMocks.fetch.mockReset();
    undiciMocks.Agent.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("blocks DNS names that resolve to private IPs before fetch", async () => {
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);

    const result = await (await fetchSourceReal())("https://private.example/");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("blocked_private_or_reserved_ip");
    expect(undiciMocks.fetch).not.toHaveBeenCalled();
  });

  it("pins public DNS answers through the fetch dispatcher", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    type FetchInit = RequestInit & { dispatcher?: unknown };
    undiciMocks.fetch.mockImplementation(async (_input: Parameters<typeof globalThis.fetch>[0], _init?: FetchInit) => new Response("<title>ok</title>", { status: 200 }));

    const result = await (await fetchSourceReal())("https://public.example/");

    expect(result.ok).toBe(true);
    expect(undiciMocks.fetch).toHaveBeenCalledOnce();
    const init = undiciMocks.fetch.mock.calls[0][1];
    expect(init).toMatchObject({ redirect: "manual" });
    expect(init).toHaveProperty("dispatcher");
    const agentOptions = undiciMocks.Agent.mock.calls[0][0] as { connect: { lookup: (...args: any[]) => void } };
    let callbackArgs: unknown[] = [];
    agentOptions.connect.lookup("public.example", { all: true }, (...args: unknown[]) => { callbackArgs = args; });
    expect(callbackArgs[0]).toBeNull();
    expect(callbackArgs[1]).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("blocks redirect targets that become private or non-https", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    undiciMocks.fetch.mockImplementation(async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/" } }));

    const privateResult = await (await fetchSourceReal())("https://public.example/");
    expect(privateResult.ok).toBe(false);
    if (!privateResult.ok) expect(privateResult.error).toBe("blocked_private_or_reserved_ip");

    undiciMocks.fetch.mockImplementation(async () => new Response(null, { status: 302, headers: { location: "http://example.com/" } }));
    const protocolResult = await (await fetchSourceReal())("https://public.example/");
    expect(protocolResult.ok).toBe(false);
    if (!protocolResult.ok) expect(protocolResult.error).toBe("https_required");
  });

  it("applies the total timeout to DNS validation", async () => {
    vi.useFakeTimers();
    lookupMock.mockReturnValue(new Promise(() => undefined));

    const pending = (await fetchSourceReal())("https://slow.example/");
    await vi.advanceTimersByTimeAsync(5_001);
    const result = await pending;

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("timeout");
  });
});
