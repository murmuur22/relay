export const phases = {
  idle: ['Idle', 'No update is running.'],
  checking: ['Checking releases', 'Looking for a published, verified release.'],
  downloading: ['Downloading', 'Receiving artifact bytes. Verification follows the transfer.'],
  verifying: ['Verifying', 'Checking release provenance, artifact size and digest.'],
  staging: ['Staging', 'Preparing the verified release before activation.'],
  'backing-up': ['Backing up', 'Protecting the current Relay state before switching releases.'],
  activating: ['Activating', 'Switching to the staged release. Cancellation is no longer safe.'],
  restarting: ['Restarting Relay', 'Relay may be unavailable. This independent tab keeps monitoring.'],
  'health-checking': ['Checking readiness', 'Waiting for the expected Relay version to become ready.'],
  succeeded: ['Update complete', 'The broker confirmed the updated Relay is ready. Sign in to Relay again.'],
  failed: ['Update failed', 'The update did not complete. Review the broker details before another action.'],
  'rolled-back': ['Rolled back', 'The update did not succeed. The broker restored the previous release and state.'],
  'rollback-failed': ['Recovery required', 'Rollback failed. Operator recovery is required; Relay may remain in maintenance.'],
  cancelled: ['Transfer cancelled', 'The broker confirmed cancellation before activation.'],
  interrupted: ['Update interrupted', 'The job was interrupted. Review recovery details; do not assume Relay is ready.'],
};
export const terminalPhases = new Set(['succeeded', 'failed', 'rolled-back', 'rollback-failed', 'cancelled', 'interrupted']);
export function formatTime(value) {
  if (value === null || value === undefined || value === '') return 'Time unavailable';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 19).replace('T', ' ') + ' UTC' : 'Time unavailable';
}
export function activeJob(job) { return Boolean(job && !terminalPhases.has(job.phase) && job.phase !== 'idle'); }
export function transfer(job) {
  const bytes = Number.isSafeInteger(job?.downloadedBytes) && job.downloadedBytes >= 0 ? job.downloadedBytes : 0;
  const total = Number.isSafeInteger(job?.totalBytes) && job.totalBytes > 0 ? job.totalBytes : null;
  return { bytes, total, ratio: total ? Math.min(1, bytes / total) : null };
}
