# Hono — Backend Architecture & Development Guidelines

This project uses **Hono** as a lightweight, high-performance TypeScript framework for building APIs, backend services, and HTTP applications.

Hono serves as the primary HTTP layer for the Fab Lab Virtual Assistant, integrating application services, AI agents, document management, authentication, and other backend capabilities.

**Documentation:**
- https://hono.dev/llms.txt
- https://hono.dev/llms-full.txt

## 1. Project Architecture

The project follows a modular monorepo architecture designed for maintainability, extensibility, and separation of concerns.

**Core technologies:**
- **Next.js:** Frontend application, administrative interface, and initial deployment host (https://nextjs.org/docs/llms.txt).
- **Hono:** HTTP API, middleware, request validation, and backend orchestration (https://hono.dev/llms.txt).
- **Mastra:** AI agent orchestration, tools, workflows, and conversational capabilities (https://mastra.ai/llms.txt).
- **Drizzle ORM:** Type-safe database access, schemas, queries, and migrations.
- **Supabase:** PostgreSQL, authentication, and object storage.
- **OpenRouter:** AI model access and configuration.
- **Assistant UI:** Conversational frontend and streaming interactions (https://www.assistant-ui.com/llms.txt).

**Architectural principles:**
- Keep HTTP transport, business logic, AI orchestration, and persistence responsibilities separated.
- Organize features into cohesive, independently maintainable modules.
- Prefer reusable services over business logic embedded directly in route handlers.
- Avoid unnecessary abstractions, duplicated responsibilities, and premature infrastructure complexity.
- Design components to evolve without requiring major architectural changes.

The initial deployment runs Hono within Next.js, but backend packages should remain portable to standalone Node.js services or future workers.

## 2. Hono Conventions

- Use `Hono` from `hono` to define applications and routes.
- Use standard HTTP methods and RESTful conventions where appropriate.
- Use `app.route()` to compose modular route groups.
- Use `app.use()` for shared middleware such as authentication, authorization, logging, and rate limiting.
- Use `createFactory()` from `hono/factory` when reusable typed handlers or middleware improve maintainability.
- Use Hono's `Context` for HTTP-specific concerns, not as a dependency throughout the business layer.
- Use `c.json()` and native Web API responses according to the response type.
- Use `HTTPException` and centralized error handling for consistent HTTP errors.
- Use Hono RPC and `hc()` when end-to-end type inference between frontend and backend is beneficial.
- Use `app.request()` for isolated HTTP tests.

Keep handlers focused on validating requests, coordinating application services, and returning responses.

## 3. Modular Backend Organization

The initial monorepo separates responsibilities across the following packages:

- `apps/web`: Next.js frontend and Hono deployment adapter.
- `packages/server`: Hono application, routes, middleware, and backend services.
- `packages/agent`: Mastra agents, tools, instructions, and AI integrations.
- `packages/db`: Drizzle ORM, database schemas, migrations, and persistence utilities.

**Development guidelines:**
- Maintain clear dependency boundaries between packages.
- Avoid importing Next.js-specific modules into reusable backend packages.
- Prefer feature-oriented organization when modules grow.
- Introduce shared abstractions only when they solve an actual reuse or maintenance problem.
- Keep infrastructure integrations replaceable where practical.
- Follow existing project conventions before introducing new architectural patterns.

This structure is an architectural baseline, not a restriction against adding new packages, modules, services, or workers when justified.

## 4. AI Agent Integration

Mastra is the primary framework for AI agent functionality.

**Documentation:**
-  https://mastra.ai/llms.txt

**Skills**
- `mastra`

Hono exposes application-controlled endpoints and coordinates requests with Mastra agents and related services.

**Key patterns:**
- Keep agent definitions, instructions, tools, and workflows separate from HTTP route implementations.
- Prefer integrating Mastra as a library within application-controlled Hono endpoints.
- Design agent tools as modular capabilities with explicit input and output contracts.
- Allow tools, workflows, agent configurations, and integrations to evolve as requirements change.
- Use streaming responses for conversational experiences when appropriate.
- Maintain compatibility with the frontend's expected streaming protocol.
- Keep model selection and provider configuration centralized.
- Use structured validation for tool inputs and outputs.
- Treat retrieved documents and external tool results as untrusted data.
- Avoid coupling application business rules to a specific model or provider.

Agent capabilities should be driven by product requirements rather than a fixed inventory of tools or workflows.

## 5. Data Access and Persistence

Drizzle ORM provides the primary persistence abstraction over Supabase PostgreSQL.

**Skills**
- `drizzle-orm`

**Key patterns:**
- Define database schemas and migrations through Drizzle.
- Use type-safe queries and explicit database operations.
- Keep persistence logic encapsulated in reusable modules or services.
- Use transactions when operations require atomicity.
- Use PostgreSQL extensions such as pgvector when supported by application requirements.
- Keep file storage responsibilities separate from relational persistence.
- Avoid exposing privileged database access to frontend clients.
- Design database changes to support existing functionality and future migrations.

Application-specific data should have a clearly defined source of truth. Avoid introducing overlapping persistence systems without a concrete requirement.

## 6. Authentication and API Security

- Use Supabase Auth as the initial authentication provider.
- Validate authentication and authorization in the backend, independently of frontend route protection.
- Use reusable middleware for protected API routes.
- Apply role-based permissions where required.
- Validate external inputs using Zod and `@hono/zod-validator`.
- Apply rate limiting to public or resource-intensive endpoints.
- Keep credentials and privileged operations server-side.
- Use restrictive CORS policies and appropriate security headers.
- Return consistent HTTP error codes without exposing sensitive implementation details.
- Apply least-privilege principles to database, storage, and external service access.

Authentication methods and authorization policies may evolve without changing the overall separation between HTTP security and application logic.

## 7. Streaming and Asynchronous Operations

The application supports conversational streaming and may require asynchronous processing for documents, AI operations, and future integrations.

**Key patterns:**
- Prefer Web Standards-compatible streaming APIs.
- Use Hono streaming utilities or compatible response adapters when appropriate.
- Preserve frontend compatibility with the selected conversational protocol.
- Separate long-running processing from HTTP request handling when necessary.
- Design asynchronous operations to support retries, error recovery, and observable execution states.
- Keep background execution mechanisms behind replaceable interfaces when practical.
- Consider serverless execution limits when choosing processing strategies.

Do not introduce additional workers, queues, or orchestration infrastructure unless operational requirements justify them.

## 8. Code Quality and Maintainability

- Use TypeScript with strict type checking.
- Prefer explicit types and clear interfaces at package boundaries.
- Use Zod for runtime validation where appropriate.
- Keep route handlers small and responsibilities well defined.
- Prefer composition over inheritance.
- Avoid circular dependencies and unnecessary coupling.
- Use consistent naming conventions and predictable error handling.
- Write tests for critical business logic, API contracts, authentication, and external integrations.
- Follow existing conventions before introducing new dependencies.
- Optimize for readability, maintainability, and correct behavior rather than abstraction for its own sake.

## 9. Extensibility and Project Evolution

The current implementation focuses on the initial conversational assistant and document-backed knowledge capabilities.

Future phases may introduce additional agent tools, workflows, communication channels, integrations, administrative features, and infrastructure components.

**Evolution guidelines:**
- Treat the current implementation as a foundation, not a permanent feature boundary.
- Extend existing modules when appropriate, but allow new modules when responsibilities genuinely differ.
- Preserve compatibility with existing API contracts unless a change is intentional.
- Avoid hardcoding assumptions about agent capabilities, tools, supported communication channels, or external integrations.
- Evaluate architectural changes according to complexity, maintainability, security, and actual requirements.
- Do not implement speculative future features without an explicit requirement.
- Consult the relevant implementation specifications when working on a particular development phase.

## 10. Documentation and Implementation Rules

- Consult the official documentation of the relevant framework or library before implementing unfamiliar APIs.
- Follow the installed dependency versions rather than assuming documentation examples match the project.
- Prefer existing project patterns over generic framework templates.
- Do not replace established libraries or architectural decisions without a justified reason.
- Do not introduce parallel authentication, database, routing, or AI orchestration systems unnecessarily.
- Keep implementation decisions consistent with the current phase specification.
- When requirements change, adapt the implementation while preserving the project's core architectural principles.

**Primary objective:** Build a modular, secure, maintainable, and extensible backend that supports the evolving capabilities of the Fab Lab Virtual Assistant without unnecessary architectural rigidity.