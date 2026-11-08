// @ts-nocheck
/** Structured agent handoff prompt built from annotations and applied edits. */

// ------------------------------------------------------------ agent prompt

function buildAgentPrompt(tab, annotations, ops) {
  var lines = [];
  lines.push('【Visual Inspector · 网页标注与视觉编辑】');
  lines.push('页面：' + (tab.url || '(unknown)'));
  if (tab.title) lines.push('标题：' + tab.title);
  lines.push('');
  lines.push('说明：下面是用户在 DSH 内嵌浏览器中对页面元素做出的标注与已经实时生效的视觉修改。');
  lines.push('请先理解标注的修改意图，再修改本地源码；对已经实时生效的视觉修改，要求保留用户已经完成的效果，不要覆盖或重新猜测这些属性值。');
  lines.push('');
  if (annotations.length > 0) {
    lines.push('## 标注（' + annotations.length + ' 条）');
    annotations.forEach(function (annotation, index) {
      var element = annotation.element || {};
      lines.push('');
      lines.push('### 标注 #' + (index + 1) + ' ' + (annotation.title || shortLabel(element) || '元素'));
      lines.push('- 选择器: `' + (annotation.selector || '') + '`');
      lines.push('- 元素: `' + (element.tag || '') + (element.id ? '#' + element.id : '') + '`');
      if (element.rect) {
        lines.push(
          '- 位置: x=' + Math.round(element.rect.x) + ', y=' + Math.round(element.rect.y) + ', w=' + Math.round(element.rect.width) + ', h=' + Math.round(element.rect.height),
        );
      }
      if (element.text) lines.push('- 文本: ' + JSON.stringify(truncate(element.text, 200)));
      if (annotation.region) {
        lines.push('- 框选区域: ' + JSON.stringify(annotation.region));
      }
      if (annotation.textSelection && annotation.textSelection.text) {
        lines.push('- 选中文本: ' + JSON.stringify(truncate(annotation.textSelection.text, 500)));
      }
      if (annotation.screenshotPath) lines.push('- 截图: `' + annotation.screenshotPath + '`');
      lines.push('- 意见: ' + (annotation.note || '(未填写)'));
    });
  }
  if (ops.length > 0) {
    lines.push('');
    lines.push('## 已实时生效的视觉修改（' + ops.length + ' 条）');
    ops.forEach(function (op, index) {
      var line = '- #' + (index + 1) + ' `' + op.selector + '`';
      if (op.kind === 'style') {
        line += ' 样式 `' + op.property + '`: ' + JSON.stringify(op.before) + ' → ' + JSON.stringify(op.after);
      } else if (op.kind === 'text') {
        line += ' 文本: ' + JSON.stringify(truncate(op.before, 80)) + ' → ' + JSON.stringify(truncate(op.after, 120));
      } else if (op.kind === 'attr') {
        line += ' 属性 `' + op.attrName + '`: ' + JSON.stringify(op.before) + ' → ' + JSON.stringify(op.after);
      }
      line += '（' + (op.syncStatus === 'synced' ? '源码已同步' : op.syncStatus === 'failed' ? '源码同步失败' : '当前仅运行时预览') + '）';
      lines.push(line);
    });
  }
  lines.push('');
  lines.push('如果源码同步状态不是“已同步”，请同时把这些修改持久化到本地源码。请保持页面现有结构与风格，不要无关重构。');
  return lines.join('\n');
}

// ------------------------------------------------------- clip annotations

function clipElementLabel(clip) {
  var tag = (clip.tag || 'element').toLowerCase();
  if (clip.selector) return tag + ' · ' + truncate(clip.selector, 120);
  return tag;
}

/**
 * Context appended to the user's own message for the clip annotations the
 * composer is currently carrying. The cards themselves stay in the Client;
 * the agent receives the same facts plus the on-disk screenshot paths.
 */
function buildClipContext(clips, ops) {
  var lines = [];
  lines.push('【Visual Inspector · 网页标注与视觉修改】');
  if (clips.length > 0 && clips[0].pageUrl) lines.push('页面：' + clips[0].pageUrl);
  if (clips.length > 0 && clips[0].pageTitle) lines.push('标题：' + clips[0].pageTitle);
  lines.push('');
  lines.push('说明：下面是用户在 DSH 内嵌浏览器中标注的元素（clip 批注）与已经实时生效的视觉修改。');
  lines.push('请结合用户在这条消息里的说明理解意图，再修改本地源码；已经生效的视觉修改请保留效果，不要覆盖或重新猜测这些属性值。');

  if (clips.length > 0) {
    lines.push('');
    lines.push('## 标注（' + clips.length + ' 条）');
    clips.forEach(function (clip, index) {
      lines.push('');
      lines.push('### 标注 #' + (index + 1) + ' ' + clipElementLabel(clip));
      if (clip.selector) lines.push('- 选择器: `' + clip.selector + '`');
      if (clip.tag) lines.push('- 元素: `' + clip.tag + '`');
      if (clip.text) lines.push('- 文本: ' + JSON.stringify(truncate(clip.text, 200)));
      if (clip.region) lines.push('- 框选区域: ' + JSON.stringify(clip.region));
      if (clip.textSelection) lines.push('- 选中文本: ' + JSON.stringify(truncate(clip.textSelection, 500)));
      if (clip.screenshotPath) lines.push('- 截图: `' + clip.screenshotPath + '`');
      lines.push('- 意见: ' + (clip.note || '(未填写)'));
    });
  }

  if (ops.length > 0) {
    lines.push('');
    lines.push('## 已实时生效的视觉修改（' + ops.length + ' 条）');
    ops.forEach(function (op, index) {
      var line = '- #' + (index + 1) + ' `' + op.selector + '`';
      if (op.kind === 'style') {
        line += ' 样式 `' + op.property + '`: ' + JSON.stringify(op.before) + ' → ' + JSON.stringify(op.after);
      } else if (op.kind === 'text') {
        line += ' 文本: ' + JSON.stringify(truncate(op.before, 80)) + ' → ' + JSON.stringify(truncate(op.after, 120));
      } else if (op.kind === 'attr') {
        line += ' 属性 `' + op.attrName + '`: ' + JSON.stringify(op.before) + ' → ' + JSON.stringify(op.after);
      }
      line += '（' + (op.syncStatus === 'synced' ? '源码已同步' : op.syncStatus === 'failed' ? '源码同步失败' : '当前仅运行时预览') + '）';
      lines.push(line);
    });
  }

  lines.push('');
  lines.push('如果源码同步状态不是“已同步”，请同时把这些修改持久化到本地源码。请保持页面现有结构与风格，不要无关重构。');
  return lines.join('\n');
}
