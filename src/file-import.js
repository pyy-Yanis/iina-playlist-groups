const { script } = require('./file-import-native.js');

function validateImportPaths(paths, droppedFiles) {
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== 'string' || path[0] !== '/')) {
    throw new Error('未能获取有效的本地文件路径');
  }
  if (droppedFiles) {
    const names = paths.map((path) => path.slice(path.lastIndexOf('/') + 1)).sort();
    const expected = droppedFiles.map((file) => file.name).sort();
    if (!expected.length || JSON.stringify(names) !== JSON.stringify(expected)) {
      throw new Error('无法确认本次拖入的文件，请使用“添加文件”批量选择');
    }
  }
  return paths;
}

async function selectImportPaths(iina, droppedFiles) {
  const result = await iina.utils.exec('/usr/bin/osascript', [
    '-l', 'JavaScript', '-e', script,
    droppedFiles ? 'drop' : 'choose',
  ]);
  if (!result || result.status !== 0) throw new Error('文件导入失败，请重试或使用“添加文件”');
  return validateImportPaths(JSON.parse(result.stdout), droppedFiles);
}

module.exports = { selectImportPaths, validateImportPaths };
