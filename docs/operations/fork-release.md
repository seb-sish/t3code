# Personal fork releases

This fork follows `seb-sish/t3code` for CLI updates. Desktop builds must use
`T3CODE_DESKTOP_UPDATE_REPOSITORY=seb-sish/t3code` so they use the same release feed.
Use a new version for each build; the first custom version is `0.1.4-sebsish.1`.

## Minimal Linux x64 and Windows x64 release

Use the Node.js version in the root `package.json` and install dependencies with
`vp install --frozen-lockfile`. Build the Linux resource monitor with Rust, then
package the server with the existing scripts:

```bash
node scripts/update-release-package-versions.ts 0.1.4-sebsish.1
vp run --filter t3 build
node scripts/apply-web-brand-assets.ts production apps/server/dist/client
node apps/server/scripts/cli.ts build-exe
cargo build --locked --release --manifest-path native/resource-monitor/Cargo.toml --target x86_64-unknown-linux-gnu
mkdir -p /tmp/t3-release-monitor/linux-x64
cp native/resource-monitor/target/x86_64-unknown-linux-gnu/release/t3-resource-monitor /tmp/t3-release-monitor/linux-x64/
node scripts/build-cli-archive.ts --platform linux --arch x64 --version 0.1.4-sebsish.1 --resource-monitor-dir /tmp/t3-release-monitor --output-dir /tmp/t3-release
node scripts/smoke-cli-archive.ts --archive /tmp/t3-release/t3-0.1.4-sebsish.1-linux-x64.tar.gz --expect-version 0.1.4-sebsish.1
```

On a Windows build host with the [desktop prerequisites](development.md#desktop-artifacts),
build only NSIS x64. Copy the Linux archive to that host first. It is also the
embedded WSL runtime; a separate Windows CLI archive is unnecessary.

```bash
T3CODE_DESKTOP_UPDATE_REPOSITORY=seb-sish/t3code node scripts/build-desktop-artifact.ts --platform win --target nsis --arch x64 --build-version 0.1.4-sebsish.1 --wsl-runtime /tmp/t3-release/t3-0.1.4-sebsish.1-linux-x64.tar.gz --output-dir /tmp/t3-release
```

Keep the Linux `.tar.gz`, Windows `.exe`, its `.exe.blockmap`, and the generated
Windows update manifest. Generate `SHA256SUMS` for these files. Do not include
unpacked apps, debug YAML, macOS, ARM64, AppImage, deb, or desktop zip artifacts.
The installer is unsigned unless signing is explicitly configured.

Publish those files together under the matching `v0.1.4-sebsish.1` tag in the fork
as a regular latest release, not a GitHub prerelease: the desktop stable channel
reads the latest release even though the version contains a custom suffix.
The first update from an official CLI requires the fork download URL explicitly:

```bash
T3CODE_RELEASE_BASE_URL=https://github.com/seb-sish/t3code/releases/download t3 update 0.1.4-sebsish.1
```

Install the custom Windows `.exe` once. Later CLI and desktop updates then follow
the fork. Publishing or installing a release is a separate operation from building it.
