import metadata from './package.json' with {type:'json'};

// Shared by the Vite frontend and Node diagnostics. Bump package.json via npm version.
export const VERSION = metadata.version;
