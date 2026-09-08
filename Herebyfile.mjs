import { task } from 'hereby';

import { bootstrap as fetchDefinitions } from './scripts/bootstrap.mjs';
import { compile as compileAssembly, copyClearScriptNativeLibraries } from './scripts/build.mjs';
import { smokeTest } from './scripts/test.mjs';
import { configureLocal, deployFromArguments } from './scripts/deploy.mjs';

const configurationIndex = process.argv.indexOf('--configuration');
const configuration = configurationIndex === -1 ? 'Debug' : process.argv[configurationIndex + 1];

if (!['Debug', 'Release'].includes(configuration)) {
    throw new Error('Use --configuration Debug or --configuration Release.');
}

export const bootstrap = task({
    name: 'bootstrap',
    description: 'Fetch pinned KSP and MechJeb definitions.',
    run: fetchDefinitions,
});

export const compile = task({
    name: 'compile',
    description: 'Compile the net472 plugin.',
    dependencies: [bootstrap],
    run: () => compileAssembly(configuration),
});

export const build = task({
    name: 'build',
    description: 'Build GameData with native V8 libraries for all three desktop platforms.',
    dependencies: [compile],
    run: () => copyClearScriptNativeLibraries(configuration),
});

export default build;

export const test = task({
    name: 'test',
    description: 'Exercise real V8 and packaged native libraries, with a process timeout.',
    dependencies: [build],
    run: () => smokeTest(configuration),
});

export const deploy = task({
    name: 'deploy',
    description: 'Build and install into configured KSP (or --ksp override). Close KSP first.',
    dependencies: [build],
    run: deployFromArguments,
});

export const configure = task({
    name: 'configure',
    description: 'Save a validated local installation path: --ksp path/to/KSP.',
    run: () => configureLocal(),
});
