import { task } from 'hereby';

import { bootstrap as fetchDefinitions } from './scripts/bootstrap.ts';
import { compile as compileAssembly, copyClearScriptNativeLibraries } from './scripts/build.ts';
import { smokeTest } from './scripts/test.ts';
import { configureLocal, deployFromArguments } from './scripts/deploy.ts';
import { snapshotSource, packageRelease, type SourceSnapshot } from './scripts/package.ts';

const packaging = process.argv.includes('package');
const configurationIndex = process.argv.indexOf('--configuration');
const configuration = configurationIndex === -1 ? (packaging ? 'Release' : 'Debug') : process.argv[configurationIndex + 1];
if (packaging && configuration !== 'Release') throw new Error('Packaging requires --configuration Release.');
let sourceSnapshot: SourceSnapshot | undefined;
const packageInputs = task({
    name: 'package-inputs',
    description: 'Capture source inputs before the release build.',
    run: async () => { sourceSnapshot = await snapshotSource(); },
});

if (!['Debug', 'Release'].includes(configuration!)) {
    throw new Error('Use --configuration Debug or --configuration Release.');
}

export const bootstrap = task({
    name: 'bootstrap',
    description: 'Fetch pinned KSP and MechJeb definitions.',
    run: async () => { await fetchDefinitions(); },
});

export const compile = task({
    name: 'compile',
    description: 'Compile the net472 plugin.',
    dependencies: packaging ? [bootstrap, packageInputs] : [bootstrap],
    run: async () => { await compileAssembly(configuration!); },
});

export const build = task({
    name: 'build',
    description: 'Build GameData with native V8 libraries for all three desktop platforms.',
    dependencies: [compile],
    run: async () => { await copyClearScriptNativeLibraries(configuration!); },
});

export default build;

export const test = task({
    name: 'test',
    description: 'Exercise real V8 and packaged native libraries, with a process timeout.',
    dependencies: [build],
    run: async () => { await smokeTest(configuration!); },
});

export const deploy = task({
    name: 'deploy',
    description: 'Build and install into configured KSP (or --ksp override). Close KSP first.',
    dependencies: [build],
    run: async () => { await deployFromArguments(); },
});

export const configure = task({
    name: 'configure',
    description: 'Save a validated local installation path: --ksp path/to/KSP.',
    run: () => configureLocal(),
});

export const packageTask = task({
    name: 'package',
    description: 'Build/test Release and create a verified tester ZIP with source and checksums.',
    dependencies: [test],
    run: async () => { await packageRelease(sourceSnapshot); },
});
