// electron-builder afterPack: flips Electron's fuses in the packaged binary (before signing), so a
// shipped app can't be turned into a plain Node runtime or debugger target, and only runs the app
// code in its own app.asar, checked against the hash in the bundle. Dev runs (`electron .`) are untouched.
const path = require("path");

exports.default = async function afterPack(context) {
  const { flipFuses, FuseVersion, FuseV1Options } = await import("@electron/fuses");
  const { electronPlatformName, appOutDir, packager, arch } = context;
  const ext = { darwin: ".app", mas: ".app", win32: ".exe", linux: "" }[electronPlatformName];
  const name = electronPlatformName === "linux" ? packager.executableName : packager.appInfo.productFilename;
  const binary = path.join(appOutDir, `${name}${ext}`);
  await flipFuses(binary, {
    version: FuseVersion.V1,
    // arm64 macOS refuses a modified binary until it's signed again; ad-hoc here, real signing comes after.
    resetAdHocDarwinSignature: electronPlatformName === "darwin" && arch === 3 /* Arch.arm64 */,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
};
