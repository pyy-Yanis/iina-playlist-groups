const test = require('node:test');
const assert = require('node:assert/strict');
const { selectImportPaths, validateImportPaths } = require('../src/file-import.js');
const { addItems, createGroup, createState } = require('../src/model.js');

test('batch import preserves unicode, spaces, ordering, and existing group items', async () => {
  const paths = ['/tmp/中文 视频.mp4', '/tmp/a\nb.mp4'];
  const iina = { utils: { exec: async (file, args) => {
    assert.equal(file, '/usr/bin/osascript');
    assert.equal(args.at(-1), 'choose');
    return { status: 0, stdout: JSON.stringify(paths) };
  } } };
  const result = await selectImportPaths(iina);
  let state = createGroup(createState());
  const id = state.groups[0].id;
  state = addItems(state, id, ['/tmp/existing.mp4']);
  const next = addItems(state, id, result);
  assert.deepEqual(next.groups[0].items.map((item) => item.path), ['/tmp/existing.mp4', ...paths]);
  assert.equal(next.groups[0].items[0], state.groups[0].items[0]);
});

test('drop validates the complete batch against Finder filenames and rejects stale data', () => {
  assert.deepEqual(validateImportPaths(['/tmp/b.mp4', '/tmp/a.mp4'], [{ name: 'a.mp4' }, { name: 'b.mp4' }]), ['/tmp/b.mp4', '/tmp/a.mp4']);
  assert.throws(() => validateImportPaths(['/tmp/stale.mp4'], [{ name: 'new.mp4' }]));
  assert.throws(() => validateImportPaths(['/tmp/a.mp4'], [{ name: 'a.mp4' }, { name: 'b.mp4' }]));
  assert.throws(() => validateImportPaths(['relative.mp4']));
  assert.throws(() => validateImportPaths(null));
});

test('cancellation returns no files; native failures do not produce imported items', async () => {
  assert.deepEqual(await selectImportPaths({ utils: { exec: async () => ({ status: 0, stdout: '[]' }) } }), []);
  await assert.rejects(selectImportPaths({ utils: { exec: async () => ({ status: 1, stdout: '' }) } }));
});
