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
 * GUARD 2 — names shared across targets must MATCH in every file that uses them.
 *
 * An extension and the app are separate processes that share nothing but the app group
 * container, so these strings are necessarily duplicated: there is no shared module to
 * hold them (the App Group string is deliberately NOT in ios/App/Shared/BeaniesBrand.swift,
 * because then this guard would pass on "absent everywhere" and check nothing) and no
 * compiler check that they agree. A typo in one copy does not fail the build, does not
 * throw at runtime, and does not log — one side writes into one container while the other
 * reads another, and the feature silently vanishes.
 *
 * Two pairs today:
 *  - the Share Extension and ShareIntentPlugin (#64): every share vanishes on drift;
 *  - the widget extension's reader and WidgetBridgePlugin (#130): every widget shows
 *    "open beanies" (or "open beanies to refresh") on drift, and the read-failure relay
 *    goes quiet.
 * `appGroup` must agree across all four files.
 *
 * That is precisely the failure mode this file already exists to catch for Compile Sources.
 */
const SHARE_PAIR = {
  'share extension': 'ios/App/ShareExtension/ShareViewController.swift',
  'share plugin': 'ios/App/App/ShareIntentPlugin.swift',
};
const WIDGET_PAIR = {
  'widget reader': 'ios/App/BeaniesWidgets/WidgetSnapshotStore.swift',
  'widget plugin': 'ios/App/App/WidgetBridgePlugin.swift',
};

const constant = (name) => new RegExp(`private static let ${name} = "([^"]+)"`);

const CROSS_TARGET_CONSTANTS = [
  { name: 'appGroup', pattern: constant('appGroup'), files: { ...SHARE_PAIR, ...WIDGET_PAIR } },
  { name: 'inboxName', pattern: constant('inboxName'), files: SHARE_PAIR },
  { name: 'traceName', pattern: constant('traceName'), files: SHARE_PAIR },
  { name: 'snapshotPath', pattern: constant('snapshotPath'), files: WIDGET_PAIR },
  { name: 'readOutcomeKey', pattern: constant('readOutcomeKey'), files: WIDGET_PAIR },
];

const sourceCache = new Map();
const sourceOf = (rel) => {
  if (!sourceCache.has(rel)) sourceCache.set(rel, readFileSync(join(ROOT, rel), 'utf8'));
  return sourceCache.get(rel);
};

const mismatches = [];
for (const { name, pattern, files } of CROSS_TARGET_CONSTANTS) {
  const found = Object.entries(files).map(([role, rel]) => [
    role,
    pattern.exec(sourceOf(rel))?.[1],
  ]);
  // A constant absent from EVERY file of its group is fine (it may not exist yet); absent
  // from one but present in another, or present with different values, is the drift this
  // guard is for.
  const values = found.map(([, v]) => v);
  if (values.every((v) => v === undefined)) continue;
  if (values.some((v) => v === undefined) || new Set(values).size > 1) {
    mismatches.push(
      `    ${name}: ` +
        found
          .map(([role, v]) => `${role}=${v === undefined ? '(not found)' : `"${v}"`}`)
          .join('  vs  ')
    );
  }
}

if (mismatches.length > 0) {
  const allFiles = [
    ...new Set(CROSS_TARGET_CONSTANTS.flatMap(({ files }) => Object.values(files))),
  ];
  console.error(
    `\n\u2716 the extensions and the app disagree on ${mismatches.length} shared constant(s):\n` +
      mismatches.join('\n') +
      '\n\nThese name the SAME app-group container (and the files and keys inside it) from\n' +
      'separate targets. When they differ, one side writes where the other never reads:\n' +
      'shares vanish and widgets go blank with no error, on device and in the logs. Make\n' +
      'them identical in every file:\n' +
      allFiles.map((f) => `    ${f}`).join('\n') +
      '\n'
  );
  process.exit(1);
}

console.log(
  `\u2713 the extensions and the app agree on all ${CROSS_TARGET_CONSTANTS.length} shared constants`
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

/**
 * GUARD 4 — a resource the extension loads at runtime must be in its Resources phase.
 *
 * Third instance of one failure class. A file committed under ios/App/ does not ship just
 * because it exists: Swift needs Compile Sources (guard 1), a plugin needs registering
 * (guard 3), and an image needs Resources. All three fail the same way - the build is
 * green, the app launches, and the feature is quietly absent. `UIImage(named:)` returns nil
 * and the sheet renders a hole where the brand mark should be.
 */
const EXTENSION_ASSETS = readdirSync(join(ROOT, 'ios/App/ShareExtension')).filter((name) =>
  name.endsWith('.png')
);

// Search ONLY inside Resources build phases. A naive `project.includes(...)` also matches
// the PBXBuildFile DECLARATION line, which carries the same "<name> in Resources" comment
// and exists whether or not any phase references it - so the check passed with the asset
// removed from the phase. Guard 1 had this identical bug once; do not reintroduce it.
const resourcePhases = [
  ...project.matchAll(/isa = PBXResourcesBuildPhase;[\s\S]*?files = \(([\s\S]*?)\);/g),
]
  .map((m) => m[1])
  .join('\n');

const unbundled = EXTENSION_ASSETS.filter(
  (asset) => !resourcePhases.includes(`${asset} in Resources`)
);

if (unbundled.length > 0) {
  console.error(
    `\n\u2716 ${unbundled.length} ShareExtension asset(s) are committed but NOT in a Resources build phase:\n` +
      unbundled.map((a) => `    ${a}`).join('\n') +
      '\n\nThey will not be inside the .appex, so UIImage(named:) returns nil at runtime and\n' +
      'the sheet renders without them. Nothing else reports this - the build stays green.\n'
  );
  process.exit(1);
}

if (EXTENSION_ASSETS.length > 0) {
  console.log(
    `\u2713 all ${EXTENSION_ASSETS.length} ShareExtension asset(s) are in a Resources build phase`
  );
}

/**
 * GUARD 4b — the widget extension's runtime resources must be in ITS Resources phase.
 *
 * The same failure class as above, with worse symptoms: a font missing from the bundle makes
 * `Font.custom` fall back to SF without a word, a missing string catalog shows raw keys
 * ("widget_open_beanies") on the signed-out widget, a missing asset catalog paints holes
 * where the beanies peek, and a missing privacy manifest fails App Store review. All with a
 * green build.
 *
 * Scoped to the BeaniesWidgets TARGET's phase, not any Resources phase: the app also ships
 * an `Assets.xcassets` and a `PrivacyInfo.xcprivacy`, so a project-wide search would pass
 * with the widget's copies missing. The target is found by name, then its buildPhases.
 */
const WIDGET_TARGET = 'BeaniesWidgets';
const WIDGET_DIR = join(ROOT, 'ios/App', WIDGET_TARGET);
const WIDGET_RESOURCE = /\.(ttf|xcstrings|xcprivacy|xcassets)$/;

let widgetResources = [];
try {
  widgetResources = [
    ...readdirSync(WIDGET_DIR),
    ...readdirSync(join(WIDGET_DIR, 'Fonts')).filter((name) => name.endsWith('.ttf')),
  ].filter((name) => WIDGET_RESOURCE.test(name));
} catch {
  widgetResources = []; // no widget extension in this tree
}

if (widgetResources.length > 0) {
  // One block per target (each ends at its own closing brace), so a match can never span
  // from one target's build phases into another target's name.
  const target = [...project.matchAll(/= \{\s*isa = PBXNativeTarget;([\s\S]*?)\n\t\t\};/g)].find(
    (m) => m[1].includes(`name = ${WIDGET_TARGET};`)
  );
  const phasesList = target ? /buildPhases = \(([\s\S]*?)\);/.exec(target[1]) : null;
  const phaseIds = phasesList
    ? [...phasesList[1].matchAll(/([0-9A-F]{24})/g)].map((m) => m[1])
    : [];
  const widgetPhase = phaseIds
    .map((id) =>
      new RegExp(
        `\\t${id} /\\* [^*]+ \\*/ = \\{\\s*isa = PBXResourcesBuildPhase;[\\s\\S]*?files = \\(([\\s\\S]*?)\\);`
      ).exec(project)
    )
    .find(Boolean);

  if (!widgetPhase) {
    console.error(
      `\n\u2716 ios/App/${WIDGET_TARGET}/ has ${widgetResources.length} resource(s) but no ${WIDGET_TARGET}\n` +
        '  target with a Resources build phase was found in project.pbxproj, so none of them\n' +
        '  would ship. See docs/runbooks/native-store-submission.md § 6c.\n'
    );
    process.exit(1);
  }

  const unshipped = widgetResources.filter(
    (name) => !widgetPhase[1].includes(`${name} in Resources`)
  );
  if (unshipped.length > 0) {
    console.error(
      `\n\u2716 ${unshipped.length} ${WIDGET_TARGET} resource(s) are committed but NOT in that target's Resources phase:\n` +
        unshipped.map((a) => `    ${a}`).join('\n') +
        '\n\nThey will not be inside the widget .appex: fonts fall back to SF, the string catalog\n' +
        'shows raw keys, the asset catalog paints holes and a missing privacy manifest fails\n' +
        'review. Nothing else reports this - the build stays green.\n'
    );
    process.exit(1);
  }

  console.log(
    `\u2713 all ${widgetResources.length} ${WIDGET_TARGET} resource(s) are in its Resources build phase`
  );
}
