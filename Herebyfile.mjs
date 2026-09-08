import { task } from 'hereby';

import { bootstrap as fetchDefinitions } from './scripts/bootstrap.mjs';
import { compile as compileAssembly, copyClearScriptNativeLibraries } from './scripts/build.mjs';

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
