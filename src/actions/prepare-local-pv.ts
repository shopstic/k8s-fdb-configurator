import { createCliAction, ExitCode } from "../deps/cli-utils.ts";
import { joinPath } from "../deps/std-path.ts";
import { Type } from "../deps/typebox.ts";
import { NonEmptyString } from "../types.ts";
import { captureExec, inheritExec } from "../deps/exec-utils.ts";
import { kubectlGetJson, kubectlInherit } from "../utils.ts";
import { loggerWithContext } from "../logger.ts";

const logger = loggerWithContext("main");

export default createCliAction(
  Type.Object({
    nodeNameEnvVarName: NonEmptyString(),
    pendingDeviceIdsAnnotationName: NonEmptyString(),
    rootMountPath: Type.String(),
  }),
  async (
    {
      nodeNameEnvVarName,
      pendingDeviceIdsAnnotationName,
      rootMountPath,
    },
  ) => {
    const nodeName = Deno.env.get(nodeNameEnvVarName);

    if (!nodeName) {
      throw new Error(`${nodeNameEnvVarName} env variable is not set`);
    }

    const nodeAnnotations = await kubectlGetJson({
      args: [
        `node/${nodeName}`,
        "-o=jsonpath={.metadata.annotations}",
      ],
      schema: Type.Dict(Type.String()),
    });

    const deviceIdsString =
      (typeof nodeAnnotations[pendingDeviceIdsAnnotationName] === "string")
        ? nodeAnnotations[pendingDeviceIdsAnnotationName]
        : "";
    const deviceIds = deviceIdsString.split(",");

    if (deviceIds.length === 0) {
      logger.info(
        `Node annotation '${pendingDeviceIdsAnnotationName}' is empty, nothing to do`,
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
        cmd: ["mountpoint", mountPath],
        stdout: "null",
        stderr: "null",
      });
      const isMounted = (await mountpointCheck.status()).code === 0;

      if (!isMounted) {
        logger.info(`${mountPath} is not mounted`);
        logger.info(`Checking for existing file system inside ${devicePath}`);

        const wipefsTest = await captureExec({
          run: { cmd: ["wipefs", "-a", "-n", devicePath] },
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
        const currentFstabContent = await Deno.readTextFile("/etc/fstab");

        if (currentFstabContent.indexOf(devicePath) !== -1) {
          logger.error(
            `Device ${devicePath} found inside /etc/fstab`,
          );
          return ExitCode.One;
        }

        logger.info(`Formatting ${devicePath}`);
        await inheritExec({ run: { cmd: ["mkfs.ext4", devicePath] } });

        logger.info(`Writing ${devicePath} to /etc/fstab`);
        await Deno.writeTextFile(
          "/etc/fstab",
          currentFstabContent + "\n" +
            `${devicePath}  ${mountPath}  ext4  defaults,noatime,discard,nofail  0 0`,
        );

        await Deno.mkdir(mountPath, { recursive: true });
        await inheritExec({
          run: { cmd: ["chattr", "+i", mountPath] },
        });

        logger.info(`Going to mount ${mountPath}`);
        await inheritExec(
          {
            run: {
              cmd: [
                "nsenter",
                "-t",
                "1",
                "-m",
                "-u",
                "-n",
                "-i",
                "mount",
                `--source=${devicePath}`,
              ],
            },
          },
        );
      } else {
        logger.info(`${mountPath} is already a mountpoint, nothing to do`);
      }
    }

    logger.info(
      `Removing '${pendingDeviceIdsAnnotationName}' annotation of node ${nodeName}`,
    );

    await kubectlInherit({
      args: [
        "annotate",
        `node/${nodeName}`,
        `${pendingDeviceIdsAnnotationName}-`,
      ],
    });

    return ExitCode.Zero;
  },
);
