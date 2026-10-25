// Independently locked packages needed by standalone Relay qualification.
// Optional application snapshots must be selected by their own test entry point.
export const requiredConsumers = [
 {label:'Relay',root:new URL('../../',import.meta.url)},
 {label:'updater UI',root:new URL('../../updater/ui/',import.meta.url)},
];
