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
import { resolve, dirname, relative, join } from 'node:path';
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

/**
 * GUARD 2 — the app group + marker names must MATCH across the two targets.
 *
 * The Share Extension and the app are separate processes that share nothing but the app
 * group container, so these strings are necessarily duplicated: there is no shared module
 * to hold them and no compiler check that they agree. A typo in either one does not fail
 * the build, does not throw at runtime, and does not log — the extension writes into one
 * container while the app reads another, and every share silently vanishes.
 *
 * That is precisely the failure mode this file already exists to catch for Compile Sources.
 */
const CROSS_TARGET_CONSTANTS = [
  { name: 'appGroup', pattern: /private static let appGroup = "([^"]+)"/ },
  { name: 'inboxName', pattern: /private static let inboxName = "([^"]+)"/ },
  { name: 'traceName', pattern: /private static let traceName = "([^"]+)"/ },
];

const PAIRED_FILES = {
  extension: 'ios/App/ShareExtension/ShareViewController.swift',
  app: 'ios/App/App/ShareIntentPlugin.swift',
};

const sources = Object.fromEntries(
  Object.entries(PAIRED_FILES).map(([role, rel]) => [role, readFileSync(join(ROOT, rel), 'utf8')])
);

const mismatches = [];
for (const { name, pattern } of CROSS_TARGET_CONSTANTS) {
  const found = Object.fromEntries(
    Object.entries(sources).map(([role, text]) => [role, pattern.exec(text)?.[1]])
  );
  // A constant absent from BOTH is fine (it may not exist yet); absent from one, or present
  // in both with different values, is the drift this guard is for.
  const values = Object.values(found);
  if (values.every((v) => v === undefined)) continue;
  if (values.some((v) => v === undefined) || new Set(values).size > 1) {
    mismatches.push(
      `    ${name}: ` +
        Object.entries(found)
          .map(([role, v]) => `${role}=${v === undefined ? '(not found)' : `"${v}"`}`)
          .join('  vs  ')
    );
  }
}

if (mismatches.length > 0) {
  console.error(
    `\n\u2716 the Share Extension and the app disagree on ${mismatches.length} shared constant(s):\n` +
      mismatches.join('\n') +
      '\n\nThese name the SAME app-group container from two separate targets. When they differ,\n' +
      'the extension writes where the app never reads: every share vanishes with no error,\n' +
      'on device and in the logs. Make them identical in both files:\n' +
      `    ${PAIRED_FILES.extension}\n    ${PAIRED_FILES.app}\n`
  );
  process.exit(1);
}

console.log(
  `\u2713 the Share Extension and the app agree on all ${CROSS_TARGET_CONSTANTS.length} shared constants`
);

/**
 * GUARD 3 — every app-target CAPPlugin must be REGISTERED, not merely compiled.
 *
 * Capacitor discovers plugins that ship inside npm packages on its own. A plugin defined in
 * the APP target is not discovered: it has to be handed to the bridge explicitly, in
 * `MainViewController.capacitorDidLoad`. Android has always done the equivalent in
 * `MainActivity.onCreate`, and for two releases iOS did nothing at all.
 *
 * Nothing reports that. The Swift compiles, the app launches, `isPluginAvailable` answers a
 * plain false, and the JS reasonably reads that as "this device cannot do it". Guard 1 above
 * proves a file is COMPILED; being compiled is not the same as being reachable, which is
 * exactly the gap that shipped #64's share target and #74's biometric unlock as no-ops.
 */
const PLUGIN_HOST = 'ios/App/App/MainViewController.swift';
const APP_TARGET_DIR = join(ROOT, 'ios/App/App');

const appTargetPlugins = readdirSync(APP_TARGET_DIR)
  .filter((name) => name.endsWith('.swift'))
  .map((name) => ({ name, text: readFileSync(join(APP_TARGET_DIR, name), 'utf8') }))
  // A plugin is a CAPPlugin subclass. AppDelegate and the bridge controller are not.
  .filter(({ text }) => /\bclass\s+(\w+)\s*:\s*CAPPlugin\b/.test(text))
  .map(({ text }) => /\bclass\s+(\w+)\s*:\s*CAPPlugin\b/.exec(text)[1]);

let hostText = '';
try {
  hostText = readFileSync(join(ROOT, PLUGIN_HOST), 'utf8');
} catch {
  if (appTargetPlugins.length > 0) {
    console.error(
      `\n\u2716 ${appTargetPlugins.length} plugin(s) live in the app target but ${PLUGIN_HOST}\n` +
        '  does not exist, so NOTHING registers them and every one is invisible to JS:\n' +
        appTargetPlugins.map((p) => `    ${p}`).join('\n') +
        '\n'
    );
    process.exit(1);
  }
}

const unregistered = appTargetPlugins.filter(
  (plugin) => !hostText.includes(`registerPluginInstance(${plugin}(`)
);

if (unregistered.length > 0) {
  console.error(
    `\n\u2716 ${unregistered.length} app-target plugin(s) are compiled but NOT registered:\n` +
      unregistered.map((p) => `    ${p}`).join('\n') +
      `\n\nAdd \`bridge?.registerPluginInstance(<Plugin>())\` to capacitorDidLoad in\n` +
      `    ${PLUGIN_HOST}\n` +
      'and the matching registerPlugin(...) call in MainActivity.java.\n\n' +
      'Unregistered is INVISIBLE, not broken: the Swift compiles, the app launches, and\n' +
      'Capacitor.isPluginAvailable() answers false, which the JS reads as an unsupported\n' +
      'device. That is how #64 and #74 both shipped as silent no-ops.\n'
  );
  process.exit(1);
}

console.log(
  `\u2713 all ${appTargetPlugins.length} app-target plugin(s) are registered in ${PLUGIN_HOST.split('/').pop()}`
);
