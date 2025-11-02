import { faker } from "@faker-js/faker";
import type { DatabaseExecutor } from "../../modules/shared/infra/db.js";
import { logger } from "../../modules/shared/infra/logger.js";
import { createTenantModule } from "../../modules/tenant/tenant.index.js";

export function seedTestDb(db: DatabaseExecutor) {
  const tenantPort = createTenantModule({ db, logger });

  return {
    async createTenant(_name?: string) {
      const name = _name || faker.company.name();
      const tenantId = name.toLowerCase().replace(/ /g, "_");
      const { id } = await tenantPort.create({
        tenantId,
        name,
      });
      return { id, tenantId };
    },
  };
}
