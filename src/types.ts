import { TObject, TProperties, Type } from "./deps.ts";
import type { Static } from "./deps.ts";

export const FdbCoordinatorConfigSchema = RelaxedObject({
  name: Type.String(),
  node: Type.String({ minLength: 1 }),
  ip: Type.String({ format: "ipv4" }),
});

export type FdbCoordinatorConfig = Static<typeof FdbCoordinatorConfigSchema>;

export const FdbClusterConfigSchema = RelaxedObject({
  storageEngine: Type.Union([
    Type.Literal("ssd-2"),
    Type.Literal("ssd-redwood-experimental"),
  ]),
  redundancyMode: Type.Union([
    Type.Literal("single"),
    Type.Literal("double"),
    Type.Literal("triple"),
  ]),
  logCount: Type.Number({ minimum: 1 }),
  proxyCount: Type.Number({ minimum: 1 }),
  resolverCount: Type.Number({ minimum: 1 }),
  standbyCount: Type.Number({ minimum: 0 }),
  coordinatorServiceNames: Type.Array(Type.String()),
});

export type FdbClusterConfig = Static<typeof FdbClusterConfigSchema>;

function RelaxedObject<T extends TProperties>(
  properties: T,
): TObject<T> {
  return Type.Object<T>(properties, { additionalProperties: true });
}

export const FdbStatusSchema = RelaxedObject({
  cluster: RelaxedObject({
    configuration: Type.Optional(Type.Object({
      resolvers: Type.Number(),
      proxies: Type.Number(),
      logs: Type.Number(),
      redundancy_mode: FdbClusterConfigSchema.properties.redundancyMode,
      storage_engine: FdbClusterConfigSchema.properties.storageEngine,
    })),
    recovery_state: Type.Optional(Type.Object({
      name: Type.String(),
      description: Type.String(),
    })),
    processes: Type.Optional(Type.Dict(Type.Object({
      address: Type.String(),
      excluded: Type.Optional(Type.Boolean()),
      machine_id: Type.Optional(Type.String()),
      class_type: Type.Union([
        Type.Literal("unset"),
        Type.Literal("coordinator"),
        Type.Literal("storage"),
        Type.Literal("transaction"),
        Type.Literal("stateless"),
        Type.Literal("proxy"),
        Type.Literal("log"),
        Type.Literal("master"),
      ]),
    }))),
  }),
  client: RelaxedObject({
    database_status: RelaxedObject({
      available: Type.Boolean(),
    }),
    coordinators: RelaxedObject({
      quorum_reachable: Type.Boolean(),
      coordinators: Type.Array(Type.Object({
        address: Type.String(),
        reachable: Type.Boolean(),
      })),
    }),
  }),
});

export type FdbStatus = Static<typeof FdbStatusSchema>;
