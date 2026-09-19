import { zip, strToU8 } from 'fflate';

export async function createParcel(files, note = '') {
  if (!files.length) throw new Error('Choose at least one file.');
  if (files.length > 100 || files.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024) throw new Error('Keep this prototype below 100 files and 100 MB.');
  const names = new Set();
  for (const file of files) {
    const name = file.name.normalize('NFC');
    if (!name || strToU8(name).length > 180 || /[\\/\\\\<>:"|?*\x00-\x1f\x7f]/.test(name) || /^[. ]|[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) throw new Error('Unsupported filename. Rename this file before packing.');
    if (names.has(name.toLowerCase())) throw new Error('Duplicate filename. Rename one of the files.');
    names.add(name.toLowerCase());
  }
  const entries = Object.create(null);
  for (const file of files) entries[`files/${file.name.normalize('NFC')}`] = new Uint8Array(await file.arrayBuffer());
  entries['README.md'] = strToU8(`# A parcel for you\n\n${note}\n\nYour original files are in the files folder.\n`);
  return new Promise((resolve, reject) => zip(entries, { level: 6 }, (error, result) => error ? reject(error) : resolve(result)));
}
