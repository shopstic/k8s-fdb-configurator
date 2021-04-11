import { Type } from "../deps/typebox.ts";
import { createCliAction, ExitCode } from "../deps/cli-utils.ts";
import {
  commandWithTimeout,
  fetchCoordinatorEndpointsFromServiceNames,
  readCurrentNamespace,
  updateConnectionStringConfigMap,
} from "../utils.ts";

function generateString(length: number): string {
  return Array
    .from(
      Array(length),
      () => Math.floor(Math.random() * 36).toString(36),
    )
    .join("");
}

function NonEmptyString() {
  return Type.String({ minLength: 1 });
}

export default createCliAction(
  Type.Object({
    configMapKey: NonEmptyString(),
    configMapName: NonEmptyString(),
    serviceNames: Type.Union([Type.Array(NonEmptyString()), NonEmptyString()]),
  }),
  async (
    {
      configMapKey,
      configMapName,
      serviceNames,
    },
  ) => {
    const serviceNameArray = typeof serviceNames === "string"
      ? [serviceNames]
      : serviceNames;

    const namespace = await readCurrentNamespace();

    const hasExistingConfigMap = await (async () => {
      const cmd = [
        "kubectl",
        "get",
        `configmap/${configMapName}`,
        "-n",
        namespace,
      ];
      const child = Deno.run({
        cmd: commandWithTimeout(cmd, 5),
        stdout: "null",
        stderr: "piped",
      });

      const stderr = new TextDecoder().decode(await child.stderrOutput());
      const { code } = await child.status();

      if (code === 0) {
        return true;
      } else if (stderr.indexOf("not found") !== -1) {
        return false;
      }

      console.error(cmd.join(" "));
      throw new Error(
        `Command exited with code '${code}' and stderr: ${stderr}`,
      );
    })();

    if (hasExistingConfigMap) {
      console.log(`ConfigMap '${configMapName}' already exists, nothing to do`);
      return ExitCode.Zero;
    }

    const coordinatorEndpoints =
      await fetchCoordinatorEndpointsFromServiceNames(serviceNameArray);
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
