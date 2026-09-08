/* Executed by macOS JavaScript for Automation, not IINA's JS context. */
function run(args) {
  ObjC.import('AppKit');
  ObjC.import('Foundation');
  var paths = [];
  if (args[0] === 'choose') {
    var app = Application.currentApplication();
    app.includeStandardAdditions = true;
    try {
      var files = app.chooseFile({ withPrompt: '添加媒体文件（可多选）', multipleSelectionsAllowed: true });
      paths = files.map(function (file) { return file.toString(); });
    } catch (error) {
      if (error.errorNumber === -128) return '[]';
      throw error;
    }
  } else if (args[0] === 'drop') {
    // Read only the dragging pasteboard, never the user's clipboard.
    var board = $.NSPasteboard.pasteboardWithName($.NSDragPboard);
    var urls = board.readObjectsForClassesOptions($([$.NSURL]), $({ NSPasteboardURLReadingFileURLsOnlyKey: true }));
    if (urls) {
      for (var i = 0; i < urls.count; i++) paths.push(ObjC.unwrap(urls.objectAtIndex(i).path));
    }
  } else {
    throw new Error('Unknown import operation');
  }
  return JSON.stringify(paths.filter(function (path) {
    var directory = Ref();
    return $.NSFileManager.defaultManager.fileExistsAtPathIsDirectory($(path), directory) && !directory[0];
  }));
}

if (typeof module !== 'undefined') module.exports = { script: run.toString() };
