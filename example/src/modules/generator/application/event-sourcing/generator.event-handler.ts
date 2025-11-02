// biome-ignore assist/source/organizeImports: The editor doesn't work for this import
import {
  DeciderCommandHandler,
  EmmettError,
  IllegalStateError,
  type Command,
  type Event,
} from "@event-driven-io/emmett";
import type { KyselyEventStore } from "@wataruoguchi/emmett-event-store-kysely";
import type { AppContext } from "../../../shared/hono/context-middleware.js";
import type { GeneratorEntity } from "../../domain/generator.entity.js";

/**
 * Reference:
 * - https://event-driven.io/en/how_to_get_the_current_entity_state_in_event_sourcing/
 */

/**
 * ================================================
 * Decider
 * ================================================
 */
/**
 * 1. Read past events for a given stream (aggregate).
 * 2. Use `evolve` to fold all events and derive the current state.
 * 3. Pass the state and the new command to `decide`.
 * 4. `decide` returns new event(s).
 * 5. Persist those new events.
 *
 * decide: A function that groups our command handling into a single method. It receives the current state and a command, validates them and returns new event(s).
 * evolve: Reducer. A function that is used to build the current state from events.
 * initialState: The initial state of the domain object.
 */
export function generatorEventHandler({
  eventStore,
  getContext,
}: {
  eventStore: KyselyEventStore;
  getContext: () => AppContext;
}) {
  const handler = DeciderCommandHandler({
    decide: createDecide(getContext),
    evolve: createEvolve(),
    initialState,
  });
  return {
    create: (generatorId: string, data: GeneratorEntity) =>
      handler(
        eventStore,
        generatorId,
        // The following object is a domain command.
        {
          type: "CreateGenerator",
          data,
        },
        { partition: data.tenantId, streamType: "generator" },
      ),
    update: (generatorId: string, data: GeneratorEntity) =>
      handler(
        eventStore,
        generatorId,
        // The following object is a domain command.
        {
          type: "UpdateGenerator",
          data,
        },
        { partition: data.tenantId, streamType: "generator" },
      ),
    delete: (
      generatorId: string,
      data: { tenantId: string; generatorId: string },
    ) =>
      handler(
        eventStore,
        generatorId,
        // The following object is a domain command.
        {
          type: "DeleteGenerator",
          data,
        },
        { partition: data.tenantId, streamType: "generator" },
      ),
  };
}
export type GeneratorEventHandler = ReturnType<typeof generatorEventHandler>;

function createDecide(getContext: () => AppContext) {
  function buildMessageMetadataFromContext() {
    const { userId } = getContext();
    return { createdBy: userId };
  }
  function assertNotDeleted(
    state: DomainState,
  ): asserts state is CreatedGenerator | UpdatedGenerator {
    if (state.status === "deleted")
      throw new IllegalStateError("Generator has been deleted");
  }
  function assertInit(state: DomainState): asserts state is InitGenerator {
    if (state.status !== "init")
      throw new IllegalStateError("Generator is not initialized");
  }

  function assertCreatedOrUpdated(
    state: DomainState,
  ): asserts state is CreatedGenerator | UpdatedGenerator {
    if (state.status !== "created" && state.status !== "updated")
      throw new IllegalStateError("Generator is not created or updated");
  }
  /**
   * These functions are responsible for deciding the command's outcome using business rules and returning the event.
   * Although we should aggregate business rules into a single function, we should't/can't use async here.
   */
  const handlers = {
    createGenerator: (command: CreateGenerator): GeneratorCreated => {
      const { data: rawData } = command;
      const { tenantId, generatorId, ...data } = rawData;
      return {
        type: "GeneratorCreated",
        // This 'data' part is the only part that will be presented to the Read Model eventually. The `metadata` part is the only Write Model context.
        data: {
          eventData: data,
          eventMeta: {
            tenantId,
            generatorId,
            ...buildMessageMetadataFromContext(),
            version: 1,
          },
        },
      };
    },
    updateGenerator: (
      command: UpdateGenerator,
      state: CreatedGenerator | UpdatedGenerator,
    ): GeneratorUpdated => {
      const { data: rawData } = command;
      const { tenantId, generatorId, ...data } = rawData;

      const previousData = state.data || {};

      // Filter out undefined values and only include fields that have actually changed
      const changedFields = Object.fromEntries(
        Object.entries(data).filter(([key, value]) => {
          // Skip undefined values (they don't represent intentional updates)
          if (value === undefined) return false;

          // Include field if it has changed from previous state
          const previousValue = previousData[key as keyof typeof previousData];
          return value !== previousValue;
        }),
      ) as Partial<Omit<GeneratorEntity, "tenantId" | "generatorId">>;

      // If no fields have changed, we could throw an error or return unchanged
      // For now, we'll allow empty updates (they'll just be no-ops in evolve)
      const eventData = changedFields as Omit<
        GeneratorEntity,
        "tenantId" | "generatorId"
      >;

      return {
        type: "GeneratorUpdated",
        data: {
          eventData,
          eventMeta: {
            tenantId,
            generatorId,
            ...buildMessageMetadataFromContext(),
            version: 1,
          },
        },
      };
    },
    deleteGenerator: (command: DeleteGenerator): GeneratorDeleted => {
      const {
        data: { generatorId, tenantId },
      } = command;
      if (!generatorId) throw new IllegalStateError("ID Expected");
      return {
        type: "GeneratorDeleted",
        data: {
          eventData: null,
          eventMeta: {
            tenantId,
            generatorId,
            ...buildMessageMetadataFromContext(),
            version: 1,
          },
        },
      };
    },
  };

  /**
   * Group all commands into a unified function that is easily extensible when you add more commands:
   * It returns a domain event.
   */
  return function decide(
    command: DomainCommand,
    state: DomainState,
  ): DomainEvent {
    const { type } = command;
    switch (type) {
      case "CreateGenerator":
        assertInit(state);
        // We do not pass state to the business logic because it doesn't care about the previous state.
        return handlers.createGenerator(command);
      case "UpdateGenerator":
        assertCreatedOrUpdated(state);
        assertNotDeleted(state);
        return handlers.updateGenerator(command, state);
      case "DeleteGenerator":
        assertNotDeleted(state);
        // We do not pass state to the business logic because it doesn't care about the previous state.
        return handlers.deleteGenerator(command);
      default: {
        // @ts-expect-error
        const _notExistingCommandType: never = type;
        throw new EmmettError("Unknown command type");
      }
    }
  };
}

export function createEvolve() {
  /**
   * Calculate the next state based on the current state and the event.
   *
   * state: 0...Nth events folded.
   * event: N+1th event.
   */
  return function evolve(state: DomainState, event: DomainEvent): DomainState {
    const { type, data } = event;
    if (state.status === "deleted") return state;

    switch (type) {
      case "GeneratorCreated": {
        const nextState: DomainState = {
          status: "created",
          data: data.eventData ?? {}, // "GeneratorCreated" must be the first event. So it does not need to care about the previous state.
        };
        return nextState;
      }
      case "GeneratorUpdated": {
        const nextState: DomainState = {
          status: "updated",
          data: { ...(state.data || {}), ...data.eventData },
        };
        return nextState;
      }
      case "GeneratorDeleted": {
        const nextState: DomainState = {
          status: "deleted",
          data: null,
        };
        return nextState;
      }
      default: {
        return state;
      }
    }
  };
}

export function initialState(): DomainState {
  return {
    status: "init",
    data: null,
  };
}

/**
 * ================================================
 * Domain Object
 *
 * The type declaration may have declared elsewhere with a layered architecture.
 * ================================================
 */
type GeneratorIdOnly = Pick<GeneratorEntity, "generatorId">;

/**
 * ================================================
 * Domain State
 *
 * - status: The status of the object being used by this state machine.
 * - data: The data we want to update the data with.
 * ================================================
 */
type InitGenerator = {
  status: "init";
  data: null;
};
type CreatedGenerator = {
  status: "created";
  data: Omit<GeneratorEntity, "tenantId" | "generatorId">;
};
type UpdatedGenerator = {
  status: "updated";
  data: Omit<GeneratorEntity, "tenantId" | "generatorId">;
};
type DeletedGenerator = {
  status: "deleted";
  data: null;
};
type DomainState =
  | CreatedGenerator
  | UpdatedGenerator
  | DeletedGenerator
  | InitGenerator;
export type GeneratorDomainState = DomainState;

/**
 * ================================================
 * Domain Event
 *
 * Events record, what happened with what data. It is used in "evolve", and generated by "decide".
 * e.g.,
 * - Generator created with the given data.
 * - Generator updated with the given data.
 * - Generator deleted with the given id.
 * ================================================
 */
type GeneratorEventMeta = Pick<GeneratorEntity, "tenantId" | "generatorId"> & {
  createdBy: string;
  version: number;
};

type GeneratorCreatedData = {
  eventMeta: GeneratorEventMeta;
  eventData: Omit<GeneratorEntity, "tenantId" | "generatorId">;
};
type GeneratorUpdatedData = {
  eventMeta: GeneratorEventMeta;
  eventData: Omit<GeneratorEntity, "tenantId" | "generatorId">;
};
type GeneratorDeletedData = {
  eventMeta: GeneratorEventMeta;
  eventData: null;
};

type GeneratorCreated = Event<"GeneratorCreated", GeneratorCreatedData>;
type GeneratorUpdated = Event<"GeneratorUpdated", GeneratorUpdatedData>;
type GeneratorDeleted = Event<"GeneratorDeleted", GeneratorDeletedData>;
type DomainEvent = GeneratorCreated | GeneratorUpdated | GeneratorDeleted;

// Export discriminated union for projections (maintains type-data relationship)
export type GeneratorDomainEvent =
  | { type: "GeneratorCreated"; data: GeneratorCreatedData }
  | { type: "GeneratorUpdated"; data: GeneratorUpdatedData }
  | { type: "GeneratorDeleted"; data: GeneratorDeletedData };

/**
 * ================================================
 * Domain Command
 *
 * Commands are instructions to the application to perform a particular operation. Commands are used in "decide".
 * e.g.,
 * - Create a new generator with the given data.
 * - Update a generator with the given data.
 * - Delete a generator with the given id.
 * ================================================
 */
type CreateGenerator = Command<"CreateGenerator", GeneratorEntity>;
type UpdateGenerator = Command<"UpdateGenerator", GeneratorEntity>;
type DeleteGenerator = Command<
  "DeleteGenerator",
  GeneratorIdOnly & { tenantId: string }
>;
type DomainCommand = CreateGenerator | UpdateGenerator | DeleteGenerator;
