/**
 * Fail the build if a Swift file in the iOS app target is not actually compiled (#74).
 *
 * The App group in `project.pbxproj` lists its children EXPLICITLY — there is no
 * file-system-synchronized group — and CI does not regenerate the project. So a `.swift`
 * file committed into `ios/App/App/` is not built unless someone also added it to the target
 * in Xcode and committed the resulting project-file diff.
 *
 * That is not hypothetical. `BiometricKeystorePlugin.swift` shipped in 411ce778 with no
 * project change and was never in an iOS binary: `nativeBiometric.ts` called it, Capacitor
 * rejected the call as not-implemented, the catch classified it as `no-hardware`, and native
 * biometric unlock silently did not exist on iOS while looking like a device limitation.
 * Nothing in the test suite could catch it — the defect lived entirely in the project file.
 *
 * Run by the iOS build and release workflows, before any archive.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = resolve(ROOT, 'ios/App/App');
const PBXPROJ = resolve(ROOT, 'ios/App/App.xcodeproj/project.pbxproj');

const project = readFileSync(PBXPROJ, 'utf8');
const swiftFiles = readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.swift'));

/**
 * Only the PBXSourcesBuildPhase block decides what is COMPILED.
 *
 * Searching the whole project file is not good enough and quietly defeats the check: a
 * PBXBuildFile entry carries the same `<name> in Sources` comment, so a file that has a
 * build-file entry but was removed from the build phase still matched. Verified by removing
 * the phase entry and watching this pass.
 */
const phase = project.match(/isa = PBXSourcesBuildPhase;[\s\S]*?files = \(([\s\S]*?)\);/);
if (!phase) {
  console.error(
    '✖ could not find PBXSourcesBuildPhase in project.pbxproj — has the format changed?'
  );
  process.exit(1);
}
const compiled = phase[1];

const missing = swiftFiles.filter((name) => !compiled.includes(`${name} in Sources`));

if (missing.length > 0) {
  console.error(
    `\n✖ ${missing.length} Swift file(s) in ios/App/App/ are NOT in the app target's Compile Sources:\n` +
      missing.map((m) => `    ${m}`).join('\n') +
      '\n\nThey are committed but will NOT be in the built app, and nothing else will report it.\n' +
      'Open ios/App/App.xcodeproj in Xcode, add them to the App target, and commit the\n' +
      'resulting project.pbxproj diff. See docs/runbooks/native-store-submission.md § 6b.\n'
  );
  process.exit(1);
}

console.log(`✓ all ${swiftFiles.length} Swift file(s) in ios/App/App/ are in Compile Sources`);
