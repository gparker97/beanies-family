/**
 * Fail the build if a Swift file in the iOS project is not actually compiled (#74).
 *
 * Xcode groups list their children EXPLICITLY — there is no file-system-synchronized group
 * here — and CI does not regenerate the project. So a `.swift` file committed under
 * `ios/App/` is not built unless someone also added it to a target in Xcode and committed
 * the resulting project-file diff.
 *
 * That is not hypothetical, and it has now happened twice:
 *  - `BiometricKeystorePlugin.swift` shipped in 411ce778 with no project change and was
 *    never in an iOS binary. `nativeBiometric.ts` called it, Capacitor rejected the call as
 *    not-implemented, the catch classified it as `no-hardware`, and native biometric unlock
 *    silently did not exist on iOS while looking like a device limitation.
 *  - The entire Share Extension (#64) was committed under `ios/App/ShareExtension/` with no
 *    target at all.
 *
 * The first version of this script scanned only `ios/App/App` — the one directory that had
 * already been fixed — and so reported "all clear" over the second defect. It now walks the
 * whole tree. A guard scoped to the bug you just fixed cannot catch the next one.
 *
 * Run by the iOS build and release workflows, before any archive.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOT = resolve(ROOT, 'ios/App');
const PBXPROJ = resolve(ROOT, 'ios/App/App.xcodeproj/project.pbxproj');

/** Build output, SPM checkouts and the project bundle are not ours to compile. */
const SKIP_DIRS = new Set(['App.xcodeproj', 'build', 'DerivedData', 'Pods', 'CapApp-SPM']);

function swiftFilesUnder(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...swiftFilesUnder(resolve(dir, entry.name)));
    } else if (entry.name.endsWith('.swift')) {
      found.push(resolve(dir, entry.name));
    }
  }
  return found;
}

const project = readFileSync(PBXPROJ, 'utf8');
const swiftFiles = swiftFilesUnder(SOURCE_ROOT);

/**
 * Only a PBXSourcesBuildPhase block decides what is COMPILED, and there is one PER TARGET —
 * the extension's files are compiled by the extension's phase, so all of them are collected.
 *
 * Searching the whole project file instead would quietly defeat the check: a PBXBuildFile
 * entry carries the same `<name> in Sources` comment, so a file removed from the build phase
 * but left with a build-file entry still matched. Verified by removing a phase entry and
 * watching the naive version pass.
 */
const phases = [...project.matchAll(/isa = PBXSourcesBuildPhase;[\s\S]*?files = \(([\s\S]*?)\);/g)];
if (phases.length === 0) {
  console.error('✖ no PBXSourcesBuildPhase in project.pbxproj — has the format changed?');
  process.exit(1);
}
const compiled = phases.map((m) => m[1]).join('\n');

const missing = swiftFiles
  .filter((path) => !compiled.includes(`${path.split('/').pop()} in Sources`))
  .map((path) => relative(ROOT, path));

if (missing.length > 0) {
  console.error(
    `\n✖ ${missing.length} Swift file(s) under ios/App/ are NOT in any target's Compile Sources:\n` +
      missing.map((m) => `    ${m}`).join('\n') +
      '\n\nThey are committed but will NOT be in the built app, and nothing else will report it.\n' +
      'Open ios/App/App.xcodeproj in Xcode, add them to the right target, and commit the\n' +
      'resulting project.pbxproj diff. See docs/runbooks/native-store-submission.md § 6b.\n'
  );
  process.exit(1);
}

console.log(`✓ all ${swiftFiles.length} Swift file(s) under ios/App/ are in Compile Sources`);
