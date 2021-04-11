import {
  captureExec,
  createCliAction,
  ExitCode,
  NonZeroExitError,
  Type,
} from "../deps.ts";
import {
  commandWithTimeout,
  fetchCoordinatorEndpointsFromServiceNames,
  readCurrentNamespace,
  updateConnectionStringConfigMap,
} from "../utils.ts";

function generateString(length: number) {
  Array.from(Array(length), () => Math.floor(Math.random() * 36).toString(36))
    .join("");
}

export default createCliAction(
  Type.Object({
    configMapKey: Type.String({ minLength: 1 }),
    configMapName: Type.String({ minLength: 1 }),
    serviceNames: Type.Array(Type.String({ minLength: 1 })),
  }),
  async (
    {
      configMapKey,
      configMapName,
      serviceNames,
    },
  ) => {
    const namespace = await readCurrentNamespace();

    const hasExistingConfigMap = await (async () => {
      try {
        await captureExec({
          run: {
            cmd: commandWithTimeout([
              "kubectl",
              "get",
              `configmap/${configMapName}`,
              "-n",
              namespace,
            ], 5),
          },
        });

        return true;
      } catch (e) {
        if (
          e instanceof NonZeroExitError && e.output &&
          e.output.indexOf("not found") !== -1
        ) {
          return false;
        }

        throw e;
      }
    })();

    if (hasExistingConfigMap) {
      console.log(`ConfigMap '${configMapName}' already exists, nothing to do`);
      return ExitCode.Zero;
    }

    const coordinatorEndpoints =
      await fetchCoordinatorEndpointsFromServiceNames(serviceNames);
    const clusterDescription = generateString(32);
    const clusterId = generateString(8);
    const connectionString = `${clusterDescription}:${clusterId}@${
      coordinatorEndpoints.join(",")
    }`;

    console.log(
      `Going to create ConfigMap '${configMapName}' with data key '${configMapKey}' and value '${connectionString}'`,
    );

    await updateConnectionStringConfigMap({
      configMapKey,
      configMapName,
      connectionString,
    });

    console.log(`ConfigMap '${configMapName}' created successfully!`);

    return ExitCode.Zero;
  },
);
