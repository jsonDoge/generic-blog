import type { Env } from "./env";
import { handleAdmin } from "./admin";

export { ResearchWorkflow } from "./workflow";

export default {
  /** Admin UI/API. Everything else 404s — the public site is the site worker. */
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      return new Response("ok");
    }
    if (url.pathname.startsWith("/admin")) {
      return handleAdmin(req, env);
    }
    return new Response("Not found", { status: 404 });
  },

  /** Cron entrypoint: one scheduled tick = one research workflow run. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      env.RESEARCH_WORKFLOW.create({ params: {} }).then((i) =>
        console.log("started research workflow", i.id),
      ),
    );
  },
} satisfies ExportedHandler<Env>;
