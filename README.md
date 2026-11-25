# Market Map: a GTM strategy from a company website, one approved step at a time

Enter a company domain. The worker fetches the homepage and up to three
subpages of the same host (/pricing, /about, /products). Cloudflare Workers AI
then drafts a go-to-market strategy in six steps:

1. **Market research:** facts about offering, customers and pricing
2. **Segments:** up to 8, best fit first
3. **Personas:** up to 3 per segment, with KPIs and everyday problems
4. **Data sources and buying signals** (hiring, funding, new sales leader, tech stack)
5. **Filter keywords** per segment
6. **Offers and cold emails:** up to 3 per segment

Steps 3–6 run only for the top 3 segments: the first 3 that are not struck,
in the order of step 2. Strike a segment to move the next one up. More does
not fit into one Workers AI call within the 60 second limit.

Each step runs only after the previous one is approved. You can edit, delete
and add entries (segments can only be struck, with a reason); any change
marks the later steps as outdated. A step without usable entries cannot be
approved.

**What the code checks, not the model:**

- Every fact in step 1 must quote the page it names word for word. Only
  whitespace, case, typographic quotes and Unicode form are normalised; no
  fuzzy matching. Everything else is dropped with a reason, and the page
  counts the drops. "Verification check" adds an invented test claim to
  show it is caught.
- Struck segments (a reason is required) leave every later step and the
  export. Entries with an unknown or struck segment are dropped.
- Signal types and offer categories must match exact ids.
- Email bodies have at most 64 words, subjects at most 10. Numbers like
  "30%" or "3x" become `{proof}` unless they appear in a verified quote.
  Customer references ("trusted by", "used by" …) are dropped.
- Model errors, timeouts or broken JSON produce an error message, never
  substitute content.

The export is Markdown, starts with "AI draft (Workers AI), edited by a
person. Not verified research." and contains the sources and the top 3
segments with personas, signals, keywords and 3 offers each.

## Run

```bash
npm install
npm run dev      # AI switched off: the page says "AI is off"
npm run dev:ai   # with website fetch and Workers AI (needs `npx wrangler login`)
```

AI is off by default (`AI_ENABLED = "false"` in `wrangler.jsonc`). Then both
`/api/fetch` and `/api/step` answer 403. Nothing is stored: no storage, no
logs (`observability` off). Download the result before closing the page.

## Checks

```bash
npm run test:run
npm run typecheck
npm run lint
```

## Limits

- No DNS check: a public domain name that resolves to a private address
  would be fetched.
- Only the four fixed paths are read; JavaScript-rendered pages show little text.
- Segments, personas and offers are model suggestions. Only step 1 quotes are
  verified against the website.
