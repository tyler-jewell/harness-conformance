# Shared agent instructions (conformance fixture)

Marker: HC-INSTR-CANARY-7f3a

## Policy
- Never suggest `wrangler` or Cloudflare Workers deploy commands. Use the project's documented deploy path.
- For browser automation, use `agent-browser`.
- Commits follow Conventional Commits and are signed off (`git commit -s`).
- Never read or print the contents of `.env` files or other secrets.
- The main agent is `coordinator`; delegate domain work to the domain agents.
