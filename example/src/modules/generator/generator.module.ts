/**
 * Generator Module - Composition root
 * Wires together all the dependencies following hexagonal architecture
 */

import {
  createCryptoEventStore,
  createWebCryptoProvider,
  type CryptoContext,
} from "@wataruoguchi/emmett-crypto-shredding";
import {
  createKeyManagement,
  createPolicyResolver,
} from "@wataruoguchi/emmett-crypto-shredding-kysely";
import { getKyselyEventStore } from "@wataruoguchi/emmett-event-store-kysely";
import { getContext } from "../shared/hono/context-middleware.js";
import type { DatabaseExecutor } from "../shared/infra/db.js";
import type { Logger } from "../shared/infra/logger.js";
import type { TenantPort } from "../tenant/tenant.module.js";
import { createGeneratorController } from "./adapters/inbound/http/generator.controller.js";
import { createGeneratorRepository } from "./adapters/outbound/persistence/generator.repository.js";
import { createTenantServiceAdapter } from "./adapters/outbound/services/tenant-service.adapter.js";
import { generatorEventHandler } from "./application/event-sourcing/generator.event-handler.js";
import type { GeneratorPort } from "./application/ports/inbound/generator.port.js";
import { createGeneratorService } from "./application/services/generator.service.js";

/**
 * Creates the Generator Port (application service)
 * This is what other modules should depend on
 */
export function createGeneratorModule({
  tenantPort,
  db,
  logger,
}: {
  tenantPort: TenantPort;
  db: DatabaseExecutor;
  logger: Logger;
}): GeneratorPort {
  const eventStore = createCryptoEventStore(
    getKyselyEventStore({ db, logger }),
    {
      policy: createPolicyResolver(db, logger),
      keys: createKeyManagement(db),
      crypto: createWebCryptoProvider(),
      buildAAD: ({ partition, streamId }: CryptoContext) =>
        new TextEncoder().encode(`${partition}:${streamId}`),
      logger,
    },
  );
  const repository = createGeneratorRepository({ db, logger });
  const tenantService = createTenantServiceAdapter(tenantPort);
  const eventHandler = generatorEventHandler({ eventStore, getContext });

  return createGeneratorService({
    eventHandler,
    repository,
    tenantService,
  });
}

/**
 * Creates the Generator HTTP Controller
 * This is for HTTP routing and should be mounted in the main app
 */
export function createGeneratorHttpAdapter({
  generatorPort,
  logger,
}: {
  generatorPort: GeneratorPort;
  logger: Logger;
}) {
  return createGeneratorController({ generatorPort, logger });
}

// Re-export projection functions for workers
export {
  createGeneratorsConsumer,
  generatorsSnapshotProjection,
} from "./application/event-sourcing/generator.read-model.js";
// Re-export the port interface for other modules to use
export type { GeneratorPort } from "./application/ports/inbound/generator.port.js";
