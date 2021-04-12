import { createCliAction, ExitCode } from "../deps/cli-utils.ts";
import { joinPath } from "../deps/std-path.ts";
import { Type } from "../deps/typebox.ts";
import { NonEmptyString } from "../types.ts";
import { captureExec, inheritExec } from "../deps/exec-utils.ts";
import {
  kubectlGetJson,
  kubectlInherit,
  toRootElevatedCommand,
} from "../utils.ts";
import { loggerWithContext } from "../logger.ts";

const logger = loggerWithContext("main");

export default createCliAction(
  Type.Object({
    nodeNameEnvVarName: NonEmptyString(),
    pendingDeviceIdsLabelName: NonEmptyString(),
    rootMountPath: NonEmptyString(),
  }),
  async (
    {
      nodeNameEnvVarName,
      pendingDeviceIdsLabelName,
      rootMountPath,
    },
  ) => {
    const nodeName = Deno.env.get(nodeNameEnvVarName);

    if (!nodeName) {
      throw new Error(`${nodeNameEnvVarName} env variable is not set`);
    }

    const nodeLabels = await kubectlGetJson({
      args: [
        `node/${nodeName}`,
        "-o=jsonpath={.metadata.labels}",
      ],
      schema: Type.Dict(Type.String()),
    });

    const deviceIdsString =
      (typeof nodeLabels[pendingDeviceIdsLabelName] === "string")
        ? nodeLabels[pendingDeviceIdsLabelName]
        : "";
    const deviceIds = deviceIdsString.split(",");

    if (deviceIds.length === 0) {
      logger.info(
        `Node label '${pendingDeviceIdsLabelName}' is empty, nothing to do`,
      );
      return ExitCode.Zero;
    }

    logger.info(
      `Going to prepare the following ${deviceIds.length} devices: ${
        deviceIds.join(", ")
      }`,
    );

    for (const deviceId of deviceIds) {
      const devicePath = joinPath(
        "/dev/disk/by-id",
        deviceId,
      );
      const mountPath = joinPath(rootMountPath, deviceId);
      const mountpointCheck = Deno.run({
        cmd: toRootElevatedCommand(["mountpoint", mountPath]),
        stdout: "null",
        stderr: "null",
      });
      const isMounted = (await mountpointCheck.status()).code === 0;

      if (!isMounted) {
        logger.info(`${mountPath} is not mounted`);
        logger.info(`Checking for existing file system inside ${devicePath}`);

        const wipefsTest = await captureExec({
          run: {
            cmd: toRootElevatedCommand(["wipefs", "-a", "-n", devicePath]),
          },
        });

        if (wipefsTest.trim().length > 0) {
          logger.error(
            `Device possibly contains an existing file system, wipefs test output: ${wipefsTest}`,
          );
          return ExitCode.One;
        }

        logger.info(
          `Making sure /etc/fstab does not already contain a reference to ${devicePath}`,
        );
        const currentFstabContent = await captureExec({
          run: { cmd: toRootElevatedCommand(["cat", "/etc/fstab"]) },
        });

        if (currentFstabContent.indexOf(devicePath) !== -1) {
          logger.error(
            `Device ${devicePath} found inside /etc/fstab`,
          );
          return ExitCode.One;
        }

        logger.info(`Formatting ${devicePath}`);
        await inheritExec({
          run: { cmd: toRootElevatedCommand(["mkfs.ext4", devicePath]) },
        });

        logger.info(`Writing ${devicePath} to /etc/fstab`);
        await inheritExec({
          run: { cmd: toRootElevatedCommand(["tee", "/etc/fstab"]) },
          stdin: currentFstabContent + "\n" +
            `${devicePath}  ${mountPath}  ext4  defaults,noatime,discard,nofail  0 0`,
        });

        logger.info(`Creating mount path ${mountPath}`);
        await inheritExec({
          run: {
            cmd: toRootElevatedCommand(["mkdir", "-p", mountPath]),
          },
        });

        logger.info(`Making mount path ${mountPath} immutable`);
        await inheritExec({
          run: { cmd: toRootElevatedCommand(["chattr", "+i", mountPath]) },
        });

        logger.info(`Mounting ${mountPath}`);
        await inheritExec(
          {
            run: {
              cmd: toRootElevatedCommand(["mount", `--source=${devicePath}`]),
            },
          },
        );
      } else {
        logger.info(`${mountPath} is already a mountpoint, nothing to do`);
      }
    }

    logger.info(
      `Removing '${pendingDeviceIdsLabelName}' label from node ${nodeName}`,
    );

    await kubectlInherit({
      args: [
        "label",
        `node/${nodeName}`,
        `${pendingDeviceIdsLabelName}-`,
      ],
    });

    return ExitCode.Zero;
  },
);
