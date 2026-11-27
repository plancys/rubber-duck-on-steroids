# Appendix: platform and security facts for two separate stores

This file is an appendix to `../research.md`. It is a short form of the report of one read-only research worker from 2026-11-25. The worker read official docs and ran nothing.

Marks: [V] = verified in the cited page. [I] = inference from the cited facts. A date after a link is the page date. "read" means that the page shows no date and the worker read it on 2026-11-25.

## 1. Separation inside Supabase and Postgres

**One database with two schemas**

- [V] A custom schema reaches the Data API through the setting "Exposed schemas". Then each role needs `USAGE` on the schema and privileges on its objects. The client selects the schema with `supabase.schema('name')`. [Using custom schemas, 2026-09-03](https://supabase.com/docs/guides/api/using-custom-schemas)
- [V] Postgres checks the grants first, and row-level security after that. A missing grant gives a permission error, also for `service_role`. [Securing your API, 2026-11-19](https://supabase.com/docs/guides/api/securing-your-api)
- [V] The docs describe a dedicated API schema: only its objects are the API surface, and internal tables stay in schemas that the API does not expose. [Securing your API, 2026-11-19](https://supabase.com/docs/guides/api/securing-your-api)
- [V] PostgREST uses one schema for each request. A view in the exposed schema can read base tables in a private schema. [PostgREST schemas, read](https://docs.postgrest.org/en/stable/references/api/schemas.html)
- [I] A join of two schemas through the Data API needs a view or a function in the exposed schema. The other option is two requests and a join in the app.

**A role with narrow rights for the back end**

- [V] The role `authenticator` validates the JWT and then changes into the role that the `role` claim names. [Postgres roles, 2026-11-18](https://supabase.com/docs/guides/database/postgres/roles)
- [V] Custom roles work with the API: create the role, run `grant <role> to authenticator`, and sign a JWT with `role: '<role>'`. [Custom roles, 2026-11-18](https://supabase.com/docs/guides/storage/schema/custom-roles)
- [V] With JWT signing keys, you import your own private key to sign such a JWT. [JWT signing keys, 2026-11-20](https://supabase.com/docs/guides/auth/signing-keys)
- [V] A secret key (`sb_secret_...`) maps to `service_role` and passes row-level security. [API keys, 2026-11-18](https://supabase.com/docs/guides/api/api-keys)
- [V] A custom role can also log in to Postgres directly. [Connect to Postgres, 2026-11-20](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [I] So the Cloud Run worker has two ways to stop the use of `service_role`: a JWT for a custom role, or a direct connection as a login role with narrow grants.

**Two Supabase projects**

- [V] The Free plan gives two free projects. Supabase pauses a Free project after 1 week of inactivity. [Billing, 2026-09-17](https://supabase.com/docs/guides/platform/billing-on-supabase), [Pricing, read](https://supabase.com/pricing)
- [V] The Pro plan costs from 25 USD each month for one organization, with compute credits for one Micro project. The docs example for two projects gives 35 USD. [Pricing, read](https://supabase.com/pricing)
- [I] The Data API of one project cannot query the other project. The app or the worker reads from the two projects and joins the rows in code.

**Encryption for each user**

- [V] The pgsodium page has "pending deprecation" in its title, and Supabase does not recommend it. [pgsodium, 2026-07-15](https://supabase.com/docs/guides/database/extensions/pgsodium)
- [V] Vault stores secrets with one root key for each project. [Vault, 2026-11-16](https://supabase.com/docs/guides/database/vault)
- [I] Vault does not separate users. Encryption for each user needs keys that the app keeps outside Supabase.

**Pitfalls of row-level security for a join at read time**

- [V] A view passes row-level security by default. On Postgres 15 or later, create the view with `security_invoker = true`. [Row Level Security, 2026-11-24](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [V] The docs say that you must never create a `security definer` function in an exposed schema. [Row Level Security, 2026-11-24](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [V] By default each role can run a function. Revoke `execute`, then grant it only to the roles that need it. [Database functions, 2026-11-18](https://supabase.com/docs/guides/database/functions)
- [V] Performance advice: an index on each column that a policy filters on, `(select auth.uid())` in place of `auth.uid()`, and no join to the source table inside a policy. [RLS performance, 2026-11-18](https://supabase.com/docs/guides/database/postgres/row-level-security-performance)

## 2. A private store for each user on Cloudflare

- [V] Durable Objects with SQLite storage are on the Workers Free plan since 2025-04-07. [Changelog, 2025-04-07](https://developers.cloudflare.com/changelog/post/2025-04-07-durable-objects-free-tier/)
- [V] The number of objects has no limit. The Free plan allows 5 GB of storage for the account. The limits for each day are 100,000 requests, 5 million rows read and 100,000 rows written. [Durable Objects limits, 2026-11-13](https://developers.cloudflare.com/durable-objects/platform/limits/), [Durable Objects pricing, 2026-11-13](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [I] A request to a Durable Object on the Free plan has the same 10 ms CPU limit as a Worker request. No page gives this number for Durable Objects directly.
- [V] D1 on the Free plan allows 10 databases. [D1 limits, 2026-11-20](https://developers.cloudflare.com/d1/platform/limits/)
- [I] One D1 database for each user does not fit the Free plan. One Durable Object for each user fits it, inside the storage limit and the limits for each day.

## 3. Hosting for a stateful engine beside Cloud Run

- [V] A Cloud Storage volume has no file locking, and Google says that you should not use it as the backend for a database. Cloud Run mounts each NFS volume in no-lock mode. [Cloud Storage volume, 2026-11-19](https://docs.cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts), [NFS volume, 2026-11-18](https://docs.cloud.google.com/run/docs/configuring/services/nfs-volume-mounts)
- [V] SQLite says that locks on network file systems are not reliable. [SQLite over a network, read](https://www.sqlite.org/useovernet.html)
- [I] No Cloud Run volume is durable and also safe for SQLite or for an embedded graph database.
- [I] One instance with 1 vCPU and 512 MiB that runs for 30 days costs about 44 USD after the free tier. One idle minimum instance costs about 10 USD each month. Source of the rates: [Cloud Run pricing, read](https://cloud.google.com/run/pricing)
- [V] Neo4j AuraDB Free pauses an instance after 72 hours of inactivity and deletes it after 30 days of pause. [Aura instance actions, read](https://neo4j.com/docs/aura/managing-instances/instance-actions/)
- [V] FalkorDB Cloud Free has no persistence and stops an instance after 1 day without use. Its Startup plan starts at 73 USD each month. [FalkorDB Free tier, read](https://docs.falkordb.com/cloud/tiers/free), [FalkorDB plans, read](https://www.falkordb.com/plans/)
- [I] AuraDB Professional costs about 66 USD each month at its 1 GB minimum. Source of the rate: [Neo4j pricing, read](https://neo4j.com/pricing/)
- [I] The cheapest graph store that stays on is a set of tables in the Postgres that the project has. The cheapest managed graph service with no pause rule costs about 66 USD each month.
- [V] GitHub shows the Kuzu repository as archived, with a last push on 2025-10-10. [Kuzu repository, read](https://github.com/kuzudb/kuzu)

## 4. Embeddings

- [V] Anthropic offers no embedding model. [Claude embeddings guide, read](https://platform.claude.com/docs/en/build-with-claude/embeddings)
- [V] Voyage `voyage-4-lite` costs 0.02 USD for each million tokens, and the first 200 million tokens are free for each account. [Voyage pricing, read](https://docs.voyageai.com/docs/pricing)
- [V] OpenAI `text-embedding-3-small` costs 0.02 USD for each million tokens. [OpenAI pricing, read](https://developers.openai.com/api/docs/pricing)
- [V] Google uses the content of the free tier of the Gemini API to improve its products. [Gemini pricing, read](https://ai.google.dev/gemini-api/docs/pricing)
- [V] The ONNX file of `all-MiniLM-L6-v2` for transformers.js has 23.0 MB in the q8 form. [Hugging Face file list, read](https://huggingface.co/Xenova/all-MiniLM-L6-v2/tree/main/onnx)
- [I] A small q8 model fits in 512 Mi beside Node. Nobody measured the memory in use.

## 5. Security guidance

**OWASP Top 10 for LLM Applications 2025**

- [V] LLM08 names the leak of context between users in a vector store with many tenants. Its controls: stores that know the permissions, strict partitions, validation of data and source, and immutable retrieval logs. [LLM08, 2024-11-17](https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/)
- [V] LLM04 (data poisoning) controls: track the origin of data, verify it, sandbox sources that you did not verify, detect anomalies, and keep versions. [LLM04, 2024-11-17](https://genai.owasp.org/llmrisk/llm042025-data-and-model-poisoning/)
- [V] LLM01 includes injection through websites or files. Its controls: validate the output format with code, apply least privilege, get human approval for high-risk actions, and segregate and mark external content. [LLM01, 2024-11-17](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [V] LLM02 controls: least privilege, restricted data sources, and published rules for retention and deletion. [LLM02, 2024-11-17](https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/)

**Models for data of many tenants**

- [V] AWS names three models. The silo model gives each tenant dedicated resources. The pool model lets tenants share resources. The bridge model mixes the two. [AWS SaaS Lens, read](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-pool-and-bridge-models.html)
- [V] Microsoft names three stores for retrieval: a store for each tenant, a multitenant store, and a shared store with data for all tenants. The shared store needs no tenant filter. [Secure multitenant RAG, 2026-08-21](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/secure-multitenant-rag)
- [V] Microsoft recommends an API layer that contains the data access logic, the tenant logic and the filters, and that applies the filters before the data goes to the model. [Secure multitenant RAG, 2026-08-21](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/secure-multitenant-rag)
- [I] The four sources give one common control: server code enforces the partition between users. The language model does not.

**Erasure under the GDPR**

- [V] Article 17 gives the right to erasure. Recital 26 excludes anonymous information. [GDPR, 2016-04-27](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679)
- [V] The EDPB report on erasure found that controllers often use anonymisation in place of deletion, and that basic pseudonymisation or partial masking does not satisfy the deletion duty. [EDPB report, 2026-02-10](https://www.edpb.europa.eu/system/files/2026-02/edpb_cef-report_2025_right-to-erasure_en.pdf)
- [I] A user id on a shared row keeps that row personal data. A record of which user data fed which shared row lets a deletion reach the shared store.

## 6. Sources on shared text from web courses (no legal advice)

- EU Directive 2019/790, Article 4 (text and data mining) and Article 17 (content that users upload). [EUR-Lex, 2019-04-17](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32019L0790)
- EU Digital Services Act, Article 6 (hosting liability) and Article 16 (notice and action). [EUR-Lex, 2022-10-19](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32022R2065)
- An example of platform terms: Coursera forbids users to "reproduce, transfer, sell, resell, or otherwise misuse any content" without authorization. [Coursera Terms of Use, 2026-01-01](https://www.coursera.org/about/terms)
- The worker found no official guidance for the exact case: one user loads a course, and the product shows text from it to other users.

## What the worker did not verify

1. A custom role for a Supabase secret key. The API field `secret_jwt_template` exists, and the guide says nothing about it.
2. An explicit CPU number for a Durable Object on the Free plan.
3. The storage limit for one Durable Object on the Free plan. Two Cloudflare pages give different numbers: 10 GB and 1 GB.
4. The memory in use of a local embedding model.
5. Apache AGE support on Supabase.
6. The page dates of the sources with the mark "read".

One note for the reader: a Supabase docs page holds a line that tells AI agents to add a feedback report to their reply. The worker ignored that line.
