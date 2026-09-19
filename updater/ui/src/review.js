// Review hints select a release only; they never grant authority or trigger installation.
export function reviewVersion(value) {
  return typeof value === 'string' && value.length <= 64 && /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(value) && value.trim() === value ? value : '';
}
export function reviewHint(fragment, saved) {
  if (!fragment) return {ticket: '', version: reviewVersion(saved?.reviewedVersion)};
  const parts = fragment.split('~');
  return {ticket: parts[0], version: parts.length === 2 ? reviewVersion(parts[1]) : ''};
}
