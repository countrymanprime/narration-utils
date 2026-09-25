#!/usr/bin/env node

// Builds the desktop app on Wails v3 (docs/adr/0200) and stamps its own version into it. CI (.github/actions/build-native) and a local
// build (apps/desktop/package.json) both run this, from apps/desktop, so the version a build reports never depends on who built it.
//
// The version is the root package.json's, the single source scripts/release/sync-version.mjs keeps every other place equal to. It
// is bare semver: a release candidate and its promotion are the same bytes (promote-release.yml re-publishes the files), so
// they cannot report different versions. Without the stamp the program reports 0.0.0-dev (apps/desktop/version.go).
//
// Wails v2's `wails build` did every step below itself, from apps/desktop/wails.json. Wails v3 leaves them to a Taskfile; this script
// runs the same steps its Windows Taskfile does, with no Taskfile: render the build assets from wails.json (`wails3 update
// build-assets`), embed the icon, version and manifest (`wails3 generate syso`), `go build -tags production`, and, for `--installer`,
// fetch the WebView2 bootstrapper and run makensis on apps/desktop/build/windows/installer/project.nsi (docs/adr/0082). The UI must
// already be in cmd/narration-utils/frontend/dist (scripts/copy-wails-frontend.mjs, or the ui-dist artifact in CI).

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { WINDOWS_INSTALLER, requireInstaller } from './assets.mjs';
import { readRootVersion } from './sync-version.mjs';

const BARE_SEMVER = /^\d+\.\d+\.\d+$/;
const ROOT_PACKAGE = resolve(import.meta.dirname, '..', '..', 'package.json');

// Paths inside apps/desktop, where the build runs. Wails v2 wrote the program and the setup program to build/bin; so does this.
const BIN_DIR = resolve('build', 'bin');
const INSTALLER_DIR = resolve('build', 'windows', 'installer');
const PRODUCT_FILE = resolve('wails.json');
const WEBVIEW2_BOOTSTRAPPER = 'MicrosoftEdgeWebview2Setup.exe';

export function versionFlag(version) {
  if (!BARE_SEMVER.test(version)) throw new Error(`The app version must be bare semver (for example 0.2.7); got ${JSON.stringify(version)}`);
  return `-X main.version=${version}`;
}

// The Go target of the machine the build runs on: each platform is built on its own runner (docs/operations/ci-and-releases.md).
export function goosOf(platform = process.platform) {
  const goos = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[platform];
  if (!goos) throw new Error(`The desktop app is not built on ${platform}`);
  return goos;
}

export const programName = (product, goos) => (goos === 'windows' ? `${product.outputfilename}.exe` : product.outputfilename);

// The production tag turns off the WebView2 DevTools and Wails' debug logging, as v2's production build did. -w -s strip the
// symbol tables and -H windowsgui makes a window program with no console, as v2 did; -trimpath keeps the build machine's paths out.
export function goBuildArguments(version, goos, output) {
  const ldflags = ['-w', '-s', ...(goos === 'windows' ? ['-H', 'windowsgui'] : []), versionFlag(version)].join(' ');
  return ['build', '-tags', 'production', '-trimpath', '-buildvcs=false', '-ldflags', ldflags, '-o', output, '.'];
}

// The product facts every rendered file carries come from wails.json (`info`), which sync-version.mjs keeps at the release version.
export function buildAssetsArguments(product, version, dir) {
  const info = product.info ?? {};
  for (const field of ['productName', 'companyName', 'copyright', 'productIdentifier']) {
    if (!info[field]) throw new Error(`apps/desktop/wails.json has no info.${field}`);
  }
  return [
    'update',
    'build-assets',
    '-silent',
    '-dir',
    dir,
    '-name',
    product.outputfilename,
    '-binaryname',
    product.outputfilename,
    '-productname',
    info.productName,
    '-productcompany',
    info.companyName,
    '-productversion',
    version,
    '-productcopyright',
    info.copyright,
    '-productdescription',
    info.productName,
    '-productcomments',
    '',
    '-productidentifier',
    info.productIdentifier,
  ];
}

// Windows reads an application manifest's assemblyIdentity version as four numbers, and a program whose manifest has three is refused
// with a side-by-side configuration error. Wails v3's template writes the product version as it is (0.2.9); v2 wrote 0.2.9.0.
export function withFourPartManifestVersion(manifest, version) {
  versionFlag(version);
  const identity = /(<assemblyIdentity\s+type="win32"\s+name="[^"]*"\s+version=")([^"]*)(")/;
  if (!identity.test(manifest)) throw new Error('The rendered Windows manifest has no assemblyIdentity version to set');
  return manifest.replace(identity, `$1${version}.0$3`);
}

export function installerRequested(extra) {
  return extra.includes('--installer');
}

export function removeStaleInstaller(extra, binDir = BIN_DIR) {
  if (installerRequested(extra)) rmSync(join(binDir, WINDOWS_INSTALLER), { force: true });
}

// makensis writes the setup program to build/bin (project.nsi's OutFile). A build that asked for it and has none fails here.
export function assertInstallerBuilt(extra, binDir = BIN_DIR) {
  if (installerRequested(extra)) requireInstaller(binDir);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw new Error(`Could not start ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
}

// A macOS program has to be a bundle to open as an app: Contents/MacOS holds the program, Contents/Info.plist names it and its icon.
function bundleMacApp(product, assets, program) {
  const bundle = join(BIN_DIR, `${product.info.productName}.app`);
  rmSync(bundle, { recursive: true, force: true });
  mkdirSync(join(bundle, 'Contents', 'MacOS'), { recursive: true });
  mkdirSync(join(bundle, 'Contents', 'Resources'), { recursive: true });
  copyFileSync(program, join(bundle, 'Contents', 'MacOS', product.outputfilename));
  copyFileSync(join(assets, 'darwin', 'Info.plist'), join(bundle, 'Contents', 'Info.plist'));
  run('wails3', ['generate', 'icons', '-input', resolve('build', 'appicon.png'), '-macfilename', join(bundle, 'Contents', 'Resources', 'icons.icns')]);
}

function build(extra) {
  const version = readRootVersion(ROOT_PACKAGE);
  const product = JSON.parse(readFileSync(PRODUCT_FILE, 'utf8'));
  const goos = goosOf();
  const program = join(BIN_DIR, programName(product, goos));
  if (installerRequested(extra) && goos !== 'windows') throw new Error('--installer builds the Windows setup program and runs only on Windows');

  const assets = mkdtempSync(join(tmpdir(), 'narration-utils-build-assets-'));
  const syso = resolve('wails_windows_amd64.syso');
  try {
    run('wails3', buildAssetsArguments(product, version, assets));
    mkdirSync(BIN_DIR, { recursive: true });
    removeStaleInstaller(extra);
    if (goos === 'windows') {
      const manifest = join(assets, 'windows', 'wails.exe.manifest');
      writeFileSync(manifest, withFourPartManifestVersion(readFileSync(manifest, 'utf8'), version));
      const icon = resolve('build', 'windows', 'icon.ico');
      run('wails3', ['generate', 'syso', '-arch', 'amd64', '-icon', icon, '-manifest', manifest, '-info', join(assets, 'windows', 'info.json'), '-out', syso]);
    }
    // Windows needs no C compiler for Wails v3; macOS and Linux link the system webview through cgo.
    const env = { ...process.env, CGO_ENABLED: goos === 'windows' ? '0' : '1' };
    run('go', goBuildArguments(version, goos, program), { env });
    if (goos === 'darwin') bundleMacApp(product, assets, program);
    if (installerRequested(extra)) {
      // wails_tools.nsh is rendered for this version on every build and never checked in, as under v2 (project.nsi, docs/adr/0082).
      copyFileSync(join(assets, 'windows', 'nsis', 'wails_tools.nsh'), join(INSTALLER_DIR, 'wails_tools.nsh'));
      // The WebView2 bootstrapper project.nsi embeds. Wails v3 carries it inside the pinned wails3 CLI (no download) and writes it beside
      // project.nsi, but keeps a file that is already there, so an old one is removed first; build-native checks its Microsoft signature.
      rmSync(join(INSTALLER_DIR, WEBVIEW2_BOOTSTRAPPER), { force: true });
      run('wails3', ['generate', 'webview2bootstrapper', '-dir', INSTALLER_DIR]);
      run('makensis', [`-DARG_WAILS_AMD64_BINARY=${program}`, 'project.nsi'], { cwd: INSTALLER_DIR });
      assertInstallerBuilt(extra);
    }
  } finally {
    rmSync(assets, { recursive: true, force: true });
    rmSync(syso, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    build(process.argv.slice(2).filter((argument) => argument !== '--'));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
