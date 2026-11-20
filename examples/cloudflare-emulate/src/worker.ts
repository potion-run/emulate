/**
 * The Worker half of the example: it calls "the GitHub API" only through
 * `GITHUB_API_URL` and `GITHUB_TOKEN`, so the same code runs against the
 * emulator under `alchemy dev` and the real API on `alchemy deploy` —
 * whatever the stack bound into `env` decides.
 */
export interface Env {
  GITHUB_API_URL: string;
  GITHUB_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== "/zen" && url.pathname !== "/user") {
      return new Response("Not Found", { status: 404 });
    }

    const response = await fetch(`${env.GITHUB_API_URL}${url.pathname}`, {
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        "user-agent": "cloudflare-emulate-example",
      },
    });

    return new Response(await response.text(), {
      status: response.status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
} satisfies ExportedHandler<Env>;
