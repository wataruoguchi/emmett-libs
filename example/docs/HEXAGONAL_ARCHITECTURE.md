# Hexagonal Architecture (Ports and Adapters)

This project follows **Hexagonal Architecture** (also known as Ports and Adapters) as a **Modular Monolith**.

## 📐 Architecture Overview

### What is Hexagonal Architecture?

Hexagonal Architecture separates your application into three main layers:

1. **Domain** - Pure business logic and entities (no dependencies on infrastructure)
2. **Application** - Use cases and orchestration (depends only on domain)
3. **Adapters** - Implementation of ports for external systems (HTTP, database, etc.)

### Key Principles

- **Dependency Inversion**: Dependencies point inward (Domain ← Application ← Adapters)
- **Port Interfaces**: Define contracts between layers
- **Testability**: Business logic can be tested without infrastructure
- **Module Independence**: Each module is self-contained with clear boundaries

## 🗂️ Module Structure

Each module follows this structure:

```
module/
├── domain/                        # Pure business logic
│   └── entity.ts                 # Domain entities and value objects
│
├── application/                   # Application layer
│   ├── ports/
│   │   ├── inbound/              # What the module OFFERS
│   │   │   └── module.port.ts   # Use case interfaces (public API)
│   │   └── outbound/             # What the module NEEDS
│   │       ├── repository.port.ts      # Data persistence interfaces
│   │       └── external-service.port.ts # External service interfaces
│   │
│   ├── services/                 # Application services (use case implementations)
│   │   └── module.service.ts    # Implements inbound ports
│   │
│   └── event-sourcing/           # Event sourcing logic (if applicable)
│       ├── event-handler.ts     # Command/event handlers
│       └── read-model.ts        # Projections
│
├── adapters/                      # Adapters layer
│   ├── inbound/                  # Driving adapters (trigger use cases)
│   │   └── http/
│   │       └── module.controller.ts  # HTTP routes
│   │
│   └── outbound/                 # Driven adapters (fulfill needs)
│       ├── persistence/
│       │   └── module.repository.ts  # Database implementation
│       └── services/
│           └── external-service.adapter.ts  # External service adapters
│
├── module.ts                      # Module composition root (wiring)
├── module.index.ts               # Public API exports
└── tests/                        # Module tests
```

## 🔌 Ports (Interfaces)

### Inbound Ports (Application API)

Define what the module **offers** to the outside world:

```typescript
// application/ports/inbound/cart.port.ts
export interface CartPort {
  // Commands
  create(input: CreateCartInput): Promise<CartResult>;
  addItem(input: AddItemInput): Promise<void>;
  
  // Queries
  findById(input: FindCartInput): Promise<CartEntity>;
  findAllByTenant(input: { tenantId: string }): Promise<CartEntity[]>;
}
```

### Outbound Ports (Dependencies)

Define what the module **needs** from external systems:

```typescript
// application/ports/outbound/cart-repository.port.ts
export interface CartRepositoryPort {
  findById(tenantId: string, cartId: string): Promise<CartReadModel | undefined>;
  findByTenantId(tenantId: string): Promise<CartReadModel[]>;
}

// application/ports/outbound/tenant-service.port.ts
export interface TenantServicePort {
  findById(tenantId: string): Promise<TenantEntity>;
}
```

## 🔄 Inter-Module Communication

### ✅ Correct: Through Ports

Modules communicate through **inbound ports** (application services):

```typescript
// cart.module.ts
import type { TenantPort } from "../tenant/tenant.module.js";

export function createCartModule({
  tenantPort,  // ✅ Depends on Tenant's PORT (public interface)
  db,
  logger,
}: {
  tenantPort: TenantPort;
  db: DatabaseExecutor;
  logger: Logger;
}): CartPort {
  // Create adapters
  const tenantService = createTenantServiceAdapter(tenantPort);
  const repository = createCartRepository({ db, logger });
  
  // Wire dependencies
  return createCartService({
    tenantService,
    repository,
    // ...
  });
}
```

### ❌ Incorrect: Direct Dependencies

**NEVER** access other modules' repositories or adapters directly:

```typescript
// ❌ BAD: Direct dependency on another module's repository
import { createTenantRepository } from "../tenant/adapters/outbound/persistence/tenant.repository.js";

// ❌ BAD: Bypassing the module's public interface
```

## 🏗️ Module Composition

The `module.ts` file is the **composition root** where all dependencies are wired together:

```typescript
// tenant.module.ts

/**
 * Creates the Tenant Port (application service)
 * This is what other modules should depend on
 */
export function createTenantModule({
  db,
  logger,
}: {
  db: DatabaseExecutor;
  logger: Logger;
}): TenantPort {
  // Create adapters (outbound)
  const repository = createTenantRepository({ db, logger });
  
  // Create and return application service (inbound port implementation)
  return createTenantService({ repository });
}

/**
 * Creates the Tenant HTTP Controller
 * This is for HTTP routing and should be mounted in the main app
 */
export function createTenantHttpAdapter({
  tenantPort,
  logger,
}: {
  tenantPort: TenantPort;
  logger: Logger;
}) {
  return createTenantController({ tenantPort, logger });
}

// Re-export the port interface
export type { TenantPort } from "./application/ports/inbound/tenant.port.js";
```

## 🎯 Benefits

### 1. **Testability**

Business logic is isolated from infrastructure:

```typescript
// Test without HTTP or database
const mockRepository: CartRepositoryPort = {
  findById: vi.fn(),
  findByTenantId: vi.fn(),
};

const mockTenantService: TenantServicePort = {
  findById: vi.fn().mockResolvedValue({ id: "tenant-1", name: "Test" }),
};

const cartService = createCartService({
  repository: mockRepository,
  tenantService: mockTenantService,
  // ...
});
```

### 2. **Flexibility**

Swap implementations without changing business logic:

```typescript
// Use PostgreSQL in production
const repository = createCartRepository({ db: postgresDb, logger });

// Use in-memory store for tests
const repository = createInMemoryCartRepository();

// Both implement CartRepositoryPort
```

### 3. **Clear Boundaries**

Each module has well-defined responsibilities:

- **Domain**: What is a Cart?
- **Application**: What can you do with a Cart?
- **Adapters**: How do you interact with Carts via HTTP? How are Carts stored?

### 4. **Independent Evolution**

Change database implementation without affecting:
- HTTP controllers
- Business logic
- Other modules

### 5. **Dependency Inversion**

High-level modules (business logic) don't depend on low-level modules (infrastructure):

```
┌─────────────────────────────────────────┐
│         Domain (Entities)               │  ← No dependencies
└─────────────────────────────────────────┘
              ↑
              │ depends on
              │
┌─────────────────────────────────────────┐
│      Application (Use Cases)            │  ← Depends only on Domain
│  ┌────────────┐      ┌────────────┐     │
│  │   Ports    │      │  Services  │     │
│  │ (interfaces)│ ←─── │ (impl)     │     │
│  └────────────┘      └────────────┘     │
└─────────────────────────────────────────┘
              ↑
              │ implements
              │
┌─────────────────────────────────────────┐
│         Adapters (Infrastructure)       │  ← Implements ports
│  ┌─────────┐    ┌──────────┐            │
│  │  HTTP   │    │ Database │            │
│  └─────────┘    └──────────┘            │
└─────────────────────────────────────────┘
```

## 🚀 Main Application Composition

The main `index.ts` composes modules and mounts adapters:

```typescript
import { getDb } from "./modules/shared/infra/db.js";
import { logger } from "./modules/shared/infra/logger.js";
import {
  createTenantModule,
  createTenantHttpAdapter,
} from "./modules/tenant/tenant.index.js";
import {
  createCartModule,
  createCartHttpAdapter,
} from "./modules/cart/cart.index.js";

const db = getDb();
const app = new Hono();

// 1. Create module ports (application services)
const tenantPort = createTenantModule({ db, logger });
const cartPort = createCartModule({ tenantPort, db, logger });

// 2. Mount HTTP adapters
app.route("", createTenantHttpAdapter({ tenantPort, logger }));
app.route("", createCartHttpAdapter({ cartPort, logger }));
```

## 📚 Related Concepts

### Modular Monolith

- Single deployable unit
- Organized into independent modules
- Modules communicate through well-defined interfaces
- Can be split into microservices later if needed

### Event Sourcing Integration

Event sourcing fits naturally in hexagonal architecture:

- **Domain events** are part of the domain layer
- **Event handlers** are part of the application layer
- **Event store** is accessed through an outbound port
- **Projections** update read models through repository ports

## 🎓 Further Reading

- [Alistair Cockburn - Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/)
- [Netflix - Ready for changes with Hexagonal Architecture](https://netflixtechblog.com/ready-for-changes-with-hexagonal-architecture-b315ec967749)
- [Domain-Driven Design by Eric Evans](https://www.domainlanguage.com/ddd/)

