import { captureExec, inheritExec } from "./deps/exec-utils.ts";
import { validate } from "./deps/validation-utils.ts";
import { memoizePromise } from "./deps/async-utils.ts";
import { Static, TObject, TProperties, Type } from "./deps/typebox.ts";
import { createK8sConfigMap } from "./deps/k8s-utils.ts";
import { FdbDatabaseConfig, FdbStatus, FdbStatusSchema } from "./types.ts";
import { FdbDatabaseConfigSchema } from "./types.ts";
import { loggerWithContext } from "./logger.ts";

const logger = loggerWithContext("utils");

function trimFdbCliOutput(output: string): string {
  let newLineCount = 0;

  for (let i = 0; i < output.length; i++) {
    if (output.charAt(i) === "\n") {
      newLineCount++;
    }

    // >>> option on PRIORITY_SYSTEM_IMMEDIATE
    // Option enabled for all transactions
    // >>> xxxxxxxxx
    if (newLineCount === 3) {
      return output.substr(i + 1);
    }
  }

  throw new Error(`Invalid fdbcli output: ${output}`);
}

export function commandWithTimeout(command: string[], timeoutSeconds: number) {
  return ["timeout", "-k", "0", `${timeoutSeconds}s`, ...command];
}

export async function fdbcliCaptureExec(
  command: string,
  timeoutSeconds = 30,
): Promise<string> {
  try {
    const captured = await captureExec(
      {
        run: {
          cmd: commandWithTimeout(
            toFdbcliCommand(command),
            timeoutSeconds,
          ),
        },
      },
    );

    return trimFdbCliOutput(captured);
  } catch (e) {
    if (e.message.indexOf("Command return non-zero status of: 124") !== -1) {
      throw new Error(
        `Timed out executing fdbcli with '${command}' after ${timeoutSeconds}s`,
      );
    } else {
      throw e;
    }
  }
}

export async function fdbcliInheritExec(
  command: string,
  timeoutSeconds = 30,
): Promise<void> {
  try {
    await inheritExec(
      {
        run: {
          cmd: commandWithTimeout(toFdbcliCommand(command), timeoutSeconds),
        },
      },
    );
  } catch (e) {
    if (e.message.indexOf("Command return non-zero status of: 124") !== -1) {
      throw new Error(
        `Timed out executing fdbcli with '${command}' after ${timeoutSeconds}s`,
      );
    } else {
      throw e;
    }
  }
}

export async function fetchStatus(
  timeoutMs = 30000,
): Promise<FdbStatus> {
  const json = await fdbcliCaptureExec("status json", timeoutMs);
  const parsed = JSON.parse(json);

  const statusValidation = validate(FdbStatusSchema, parsed);

  if (!statusValidation.isSuccess) {
    logger.error(json);
    throw new Error(
      `FDB status JSON payload failed schema validation: ${
        JSON.stringify(statusValidation.errors, null, 2)
      }`,
    );
  }

  return statusValidation.value;
}

export function toFdbcliCommand(command: string) {
  return [
    "fdbcli",
    "--exec",
    `option on PRIORITY_SYSTEM_IMMEDIATE; ${command}`,
  ];
}

export const readCurrentNamespace = memoizePromise(() =>
  Deno.readTextFile(
    "/var/run/secrets/kubernetes.io/serviceaccount/namespace",
  )
);

export async function readClusterConfig(
  configFile: string,
): Promise<FdbDatabaseConfig> {
  const configJson = JSON.parse(await Deno.readTextFile(configFile));
  const configValidation = validate(
    FdbDatabaseConfigSchema,
    configJson,
  );

  if (!configValidation.isSuccess) {
    logger.error(configValidation.errors);
    throw new Error("Invalid cluster config");
  }

  return configValidation.value;
}

function RelaxedObject<T extends TProperties>(
  properties: T,
): TObject<T> {
  return Type.Object<T>(properties, { additionalProperties: true });
}

export const ServiceSpecSchema = RelaxedObject({
  clusterIP: Type.String({ format: "ipv4" }),
  ports: Type.Array(
    RelaxedObject({
      port: Type.Number(),
    }),
    { minItems: 1 },
  ),
});

export type ServiceSpec = Static<typeof ServiceSpecSchema>;

export async function fetchServiceSpecs(
  serviceNames: string[],
): Promise<ServiceSpec[]> {
  const namespace = await readCurrentNamespace();
  const promises = serviceNames.map(async (name) => {
    const output = await captureExec(
      {
        run: {
          cmd: commandWithTimeout([
            "kubectl",
            "get",
            `service/${name}`,
            "-n",
            namespace,
            "-o=jsonpath={.spec}",
          ], 5),
        },
      },
    );

    const specValidation = validate(ServiceSpecSchema, JSON.parse(output));

    if (!specValidation.isSuccess) {
      logger.error(output);
      throw new Error(
        `Invalid service spec for ${name}. Errors: ${
          JSON.stringify(specValidation.errors, null, 2)
        }`,
      );
    }

    return specValidation.value;
  });

  return await Promise.all(promises);
}

export async function fetchCoordinatorEndpointsFromServiceNames(
  serviceNames: string[],
): Promise<string[]> {
  const specs = await fetchServiceSpecs(serviceNames);

  return specs.map((spec) => `${spec.clusterIP}:${spec.ports[0]!.port}`);
}

export async function updateConnectionStringConfigMap(
  { configMapKey, configMapName, connectionString }: {
    configMapKey: string;
    configMapName: string;
    connectionString: string;
  },
): Promise<void> {
  const namespace = await readCurrentNamespace();
  const configMap = createK8sConfigMap({
    metadata: {
      name: configMapName,
      namespace,
    },
    data: {
      [configMapKey]: connectionString,
    },
  });

  await inheritExec(
    {
      run: {
        cmd: commandWithTimeout(["kubectl", "apply", "-f", "-"], 5),
      },
      stdin: JSON.stringify(configMap),
    },
  );
}
