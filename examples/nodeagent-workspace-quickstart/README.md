# Agent workspace quickstart

The smallest app that runs a multi-provider, chat-native Node agent: one worker process and one React component. It depends only on the packed `@homenshum/nodeagent-engines` tarball in `vendor/` (no source imports), so it is also the proof that the package works when installed into a separate app.

```bash
npm install
# put ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY in .env.local here
npm run worker      # terminal 1: nodeagent-worker on 127.0.0.1:4317
npm run dev         # terminal 2: http://localhost:5280
```

Open the page, create a project from the "SMB-lending diligence pack" template, pick an engine, click a suggested task and send it.

The whole app is `src/main.tsx` (mount the component) and `vite.config.ts` (proxy `/agent-api` to the worker). To use your own worker port, set `NODE_AGENT_WORKER_PORT` for both commands.

Tarball: `vendor/homenshum-nodeagent-engines-0.1.0.tgz`, sha256 `1dba5c367a8a1b17b9faf56a3e36b14fac6e114bcc3ea26aef7bbd77798671f0`, built with `npm pack` from `packages/nodeagent-engines`. Rebuild it after changing the package and update the hash here.
