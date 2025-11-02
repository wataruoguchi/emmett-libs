# @wataruoguchi/emmett-libs

Event sourcing libraries built on [Emmett](https://github.com/event-driven-io/emmett).

## 📚 Documentation

**👉 [View Full Documentation →](https://wataruoguchi.github.io/emmett-libs/)**

## 📦 Packages

- **[@wataruoguchi/emmett-event-store-kysely](./packages/emmett-event-store-kysely)** - Kysely-based event store with PostgreSQL
- **[@wataruoguchi/emmett-crypto-shredding](./packages/emmett-crypto-shredding)** - Crypto shredding for event streams
- **[@wataruoguchi/emmett-crypto-shredding-kysely](./packages/emmett-crypto-shredding-kysely)** - Kysely adapters for crypto shredding

## 📖 Example Project

The [`example`](./example) directory contains a working SaaS application demonstrating how to use these packages together:

- **Event Store Integration** - See how `@wataruoguchi/emmett-event-store-kysely` is used for event sourcing with PostgreSQL
  - Located in `example/src/modules/*/application/event-sourcing/`
  - Example modules: `cart`, `generator`, `tenant`

- **Crypto Shredding Implementation** - Complete example of `@wataruoguchi/emmett-crypto-shredding` with Kysely adapters
  - See `example/src/modules/generator/application/event-sourcing/crypto/` for crypto adapters usage
  - Check `example/src/modules/generator/tests/generator.crypto.e2e.spec.ts` for comprehensive test coverage including:
    - Key scopes (stream, type, tenant)
    - Multi-tenant isolation
    - Key rotation and crypto shredding
    - Graceful error handling

- **Database Migrations** - Example migrations for both event store and crypto shredding tables
  - Event store tables in `example/database/migrations/`
  - Crypto shredding tables in `packages/emmett-crypto-shredding-kysely/database/migrations/`

- **Projections** - Examples of building read models with snapshot projections
  - See `example/src/modules/generator/application/event-sourcing/generator.event-handler.ts`
  - Example read model migrations in `example/database/migrations/`

## 📄 License

MIT
