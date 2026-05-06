export type AppTheme = 'light' | 'dark'
export type AppLocale = 'zh' | 'en'

const THEME_COOKIE = 'gip_theme'
const LOCALE_COOKIE = 'gip_locale'
const LOGIN_NOTICE_COOKIE = 'gip_login_notice'
const PERSIST_KEY = 'gpt-image-playground'

const exactEn: Record<string, string> = {
  '正在验证登录...': 'Verifying login...',
  '正在跳转统一登录...': 'Redirecting to unified login...',
  '提示': 'Notice',
  '公告': 'Announcement',
  '关闭公告': 'Dismiss announcement',
  '我知道了': 'Got it',
  '目前服务器资源有限，生成记录和图片资源会优先保存在当前浏览器中。切换账号不会改变本机已有内容；如果需要为不同账号隔离数据，建议使用不同的浏览器用户配置或独立浏览器。':
    'Server resources are currently limited, so generated records and image assets are stored primarily in this browser. Switching accounts will not change existing local content. If you need separate data for different accounts, use separate browser profiles or separate browsers.',
  '新版本': 'New version',
  '生成审计': 'Generation audit',
  '隐私模式': 'Privacy mode',
  '切换隐私模式': 'Toggle privacy mode',
  '投诉建议': 'Feedback',
  '操作指南': 'Guide',
  '设置': 'Settings',
  '用户菜单': 'User menu',
  '浅色模式': 'Light mode',
  '深色模式': 'Dark mode',
  '切换浅色模式': 'Switch to light mode',
  '切换深色模式': 'Switch to dark mode',
  '语言': 'Language',
  '退出系统': 'Sign out',
  '正在退出...': 'Signing out...',
  '列表': 'List',
  '管理设置': 'Admin settings',
  '搜索提示词、用户...': 'Search prompts, users...',
  '搜索提示词、参数...': 'Search prompts and params...',
  '模型': 'Model',
  '全部状态': 'All statuses',
  '已完成': 'Done',
  '完成': 'Done',
  '生成中': 'Generating',
  '生成中...': 'Generating...',
  '失败': 'Failed',
  '刷新': 'Refresh',
  '导出': 'Export',
  '导入': 'Import',
  '全部删除': 'Delete all',
  '加载中...': 'Loading...',
  '暂无记录': 'No records',
  '无图片': 'No image',
  '查看图片': 'View image',
  '未知用户': 'Unknown user',
  '未知': 'Unknown',
  '详情': 'Details',
  '收起': 'Collapse',
  '删除': 'Delete',
  '上一页': 'Previous',
  '下一页': 'Next',
  '服务商类型': 'Provider type',
  'OpenAI 兼容接口': 'OpenAI-compatible API',
  '每小时每用户最多生成图片数': 'Max images per user per hour',
  '每小时每用户最多隐私图片数': 'Max private images per user per hour',
  '图集上传 URL': 'Gallery upload URL',
  '图集上传 Token': 'Gallery upload token',
  '模型 ID': 'Model ID',
  'API 接口': 'API endpoint',
  '请求超时 (秒)': 'Request timeout (seconds)',
  'Codex CLI 兼容模式': 'Codex CLI compatibility mode',
  '保存中...': 'Saving...',
  '保存设置': 'Save settings',
  '上一张': 'Previous',
  '下一张': 'Next',
  '缩小': 'Zoom out',
  '放大': 'Zoom in',
  '关闭': 'Close',
  '取消': 'Cancel',
  '确认': 'Confirm',
  '确认删除': 'Confirm delete',
  '全部删除审计记录': 'Delete all audit records',
  '删除全部审计记录': 'Delete all audit records',
  '删除审计记录': 'Delete audit record',
  '只会删除服务器保存的审计记录和图片文件，不会影响用户本地任务记录。':
    'Only the server-side audit record and image files will be deleted. User local task records will not be affected.',
  '确定要删除服务器保存的全部审计记录和图片文件吗？此操作不会影响用户浏览器里的本地任务记录。':
    'Delete all server-side audit records and image files? This will not affect local task records in users browsers.',
  '审计记录已删除': 'Audit record deleted',
  '全部审计记录已删除': 'All audit records deleted',
  '删除审计记录失败': 'Failed to delete audit record',
  '删除全部审计记录失败': 'Failed to delete all audit records',
  '打开投诉建议失败': 'Failed to open feedback',
  '加载管理员设置失败': 'Failed to load admin settings',
  '管理员设置已保存': 'Admin settings saved',
  '习惯配置': 'Preferences',
  '提交任务后清空输入框': 'Clear input after submitting',
  '开启后，提交成功创建任务时会清空提示词和参考图。':
    'When enabled, the prompt and reference images are cleared after a task is created.',
  '本地数据管理': 'Local data',
  '清空本地数据': 'Clear local data',
  '确定要清空当前浏览器里的任务记录和图片数据吗？此操作不会删除服务器审计副本。':
    'Clear task records and image data in this browser? This will not delete server-side audit copies.',
  '确定要清空当前浏览器里的任务记录和图片数据吗？此操作不会影响图集内容。':
    'Clear task records and image data in this browser? This will not affect gallery content.',
  '多选记录': 'Multi-select records',
  '批量操作': 'Batch actions',
  '批量收藏': 'Batch favorite',
  '批量取消收藏': 'Batch unfavorite',
  '确认收藏': 'Confirm favorite',
  '确认取消': 'Confirm unfavorite',
  '在历史记录卡片上': 'On a history card,',
  '左右滑动': 'swipe left or right',
  '即可选中或取消选中该卡片。': 'to select or deselect it.',
  '选中一条或多条记录后，页面底部会出现操作栏，支持': 'After selecting one or more records, the bottom action bar supports',
  '批量删除': 'batch delete',
  '全选当前可见记录': 'selecting all visible records',
  '、': ', ',
  '，或': ', or',
  '。': '.',
  '使用鼠标在空白处': 'Use the mouse on empty space to',
  '拖拽框选': 'drag-select',
  '按住': 'Hold',
  '并点击卡片，可添加或移除单项。': 'and click cards to add or remove items.',
  '再次框选已选中的卡片会将其取消选中。': 'Drag-selecting selected cards again deselects them.',
  '点击卡片外任意空白处可取消所有选择。': 'Click empty space outside cards to clear selection.',
  '只看收藏': 'Favorites only',
  '取消只看收藏': 'Show all records',
  '复制': 'Copy',
  '下载': 'Download',
  '编辑': 'Edit',
  '图片已复制': 'Image copied',
  '复制失败': 'Copy failed',
  '开始下载': 'Download started',
  '下载失败': 'Download failed',
  '参考图数量已达上限（16 张），无法继续添加': 'The reference image limit is 16. No more images can be added.',
  '已加入参考图': 'Added to reference images',
  '编辑遮罩': 'Edit mask',
  '添加遮罩': 'Add mask',
  '清空遮罩主图、参考图和遮罩': 'Clear mask source, references, and mask',
  '清空全部参考图': 'Clear all reference images',
  '清空全部': 'Clear all',
  '清空': 'Clear',
  '只能有一张遮罩图': 'Only one mask image is allowed',
  '选择尺寸': 'Choose size',
  'Codex CLI 不支持质量参数': 'Codex CLI does not support the quality parameter',
  'fal.ai 不支持': 'fal.ai does not support',
  '参数': 'parameter',
  '请先移除部分参考图后再添加': 'Remove some reference images before adding more',
  '释放以添加参考图': 'Release to add reference images',
  '支持 JPG、PNG、WebP 等格式': 'Supports JPG, PNG, WebP, and other formats',
  '取消选择': 'Cancel selection',
  '取消全选': 'Deselect all',
  '全选当前可见': 'Select all visible',
  '收藏/取消收藏': 'Favorite/unfavorite',
  '删除选中': 'Delete selected',
  '描述你想生成的图片...': 'Describe the image you want to generate...',
  '添加参考图': 'Add reference image',
  '遮罩编辑 (Ctrl+Enter)': 'Edit mask (Ctrl+Enter)',
  '生成 (Ctrl+Enter)': 'Generate (Ctrl+Enter)',
  '图片已不存在，无法编辑遮罩': 'The image no longer exists, so the mask cannot be edited',
  '遮罩已保存': 'Mask saved',
  '已移除遮罩': 'Mask removed',
  '移除遮罩': 'Remove mask',
  '当前浏览器不支持 Canvas': 'This browser does not support Canvas',
  '遮罩尺寸与当前图片不一致': 'The mask size does not match the current image',
  '图片导出失败': 'Image export failed',
  '请先涂抹需要编辑的区域': 'Paint the area you want to edit first',
  '遮罩主图已不存在，请重新选择遮罩区域': 'The mask source image no longer exists. Select the mask area again',
  '确定要撤销对这张图片的所有涂抹并移除遮罩吗？': 'Remove all painting from this image and delete the mask?',
  '遮罩编辑说明': 'Mask edit note',
  '根据官方文档说明，此功能仅基于提示词，无法完全控制模型编辑区域':
    'Per the official docs, this feature is prompt-based and cannot fully control the edited region.',
  '保存': 'Save',
  '正在载入图片...': 'Loading image...',
  '画笔': 'Brush',
  '橡皮': 'Eraser',
  '调节笔刷大小': 'Adjust brush size',
  '撤销': 'Undo',
  '重做': 'Redo',
  '重置视图': 'Reset view',
  '清空遮罩': 'Clear mask',
  '取消收藏': 'Unfavorite',
  '收藏记录': 'Favorite record',
  '复用配置': 'Reuse config',
  '编辑输出': 'Edit output',
  '删除记录': 'Delete record',
  '重试失败任务': 'Retry failed task',
  '输入内容': 'Input',
  '复制提示词': 'Copy prompt',
  '提示词已被改写': 'Prompt was revised',
  '参考图': 'Reference image',
  '复制参考图': 'Copy reference image',
  '参数配置': 'Parameters',
  '来源': 'Source',
  '尺寸': 'Size',
  '质量': 'Quality',
  '格式': 'Format',
  '审核': 'Moderation',
  '数量': 'Count',
  '压缩率': 'Compression',
  '创建于': 'Created',
  '耗时': 'Duration',
  '重连中': 'Reconnecting',
  '完整报错已复制': 'Full error copied',
  '复制完整报错': 'Copy full error',
  '复制报错失败': 'Failed to copy error',
  '提示词已复制': 'Prompt copied',
  '复制提示词失败': 'Failed to copy prompt',
  '参考图已复制': 'Reference image copied',
  '复制参考图失败': 'Failed to copy reference image',
  '设置图像尺寸': 'Set image size',
  '当前：': 'Current: ',
  '自动': 'Auto',
  '按比例': 'By ratio',
  '自定义宽高': 'Custom size',
  '自动尺寸': 'Auto size',
  '不向模型传递具体的分辨率参数': 'Do not pass a specific resolution to the model',
  '由模型自己决定生成尺寸': 'Let the model decide the output size',
  '基准分辨率': 'Base resolution',
  '图像比例': 'Aspect ratio',
  '自定义比例': 'Custom ratio',
  '输入自定义比例': 'Enter custom ratio',
  '输入具体像素值': 'Enter pixel size',
  '宽度 (Width)': 'Width',
  '高度 (Height)': 'Height',
  '将使用': 'Will use',
  '尺寸无效': 'Invalid size',
  '确定': 'OK',
  '请输入提示词': 'Enter a prompt',
  '确认编辑整张图片？': 'Edit the entire image?',
  '当前遮罩覆盖了整张图片，提交后可能会重绘全部内容。是否继续？':
    'The current mask covers the entire image. Submitting may redraw all content. Continue?',
  '继续提交': 'Continue',
  '统一配置': 'Unified config',
  '服务端模型': 'Server model',
  'API 实际响应值': 'Actual API value',
  '生成完成': 'Generation complete',
  '部分图片生成失败，已保留成功结果': 'Some images failed; successful results were kept',
  '部分失败': 'Partial failure',
  '部分失败原因已复制': 'Partial failure reason copied',
  '复制部分失败原因': 'Copy partial failure reason',
  '复制部分失败原因失败': 'Failed to copy partial failure reason',
  '数据已导出': 'Data exported',
  '所有数据已清空': 'All data cleared',
  '记录已删除': 'Record deleted',
  '接口返回的提示词已被改写': 'The API returned a revised prompt',
  '接口没有返回官方 API 会返回的部分信息': 'The API did not return some fields expected from the official API',
  '检测到 Codex CLI API': 'Codex CLI API detected',
  '开启': 'Enable',
  '(无提示词)': '(No prompt)',
}

const regexEn: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
  [/^新版本 (.+)$/, (m) => `New version ${m[1]}`],
  [/^共 (\d+) 条$/, (m) => `${m[1]} records`],
  [/^第 (\d+) 页$/, (m) => `Page ${m[1]}`],
  [/^(\d+) 张$/, (m) => `${m[1]} images`],
  [/^(\d+) 个文件$/, (m) => `${m[1]} files`],
  [/^已删除 (\d+) 条记录$/, (m) => `Deleted ${m[1]} records`],
  [/^已导入 (\d+) 条记录$/, (m) => `Imported ${m[1]} records`],
  [/^已添加 (\d+) 张输出图到输入$/, (m) => `Added ${m[1]} output images to input`],
  [/^已达上限 (\d+) 张$/, (m) => `Limit reached: ${m[1]} images`],
  [/^生成完成，共 (\d+) 张图片$/, (m) => `Generation complete, ${m[1]} images`],
  [/^fal\.ai 任务已恢复，共 (\d+) 张图片$/, (m) => `fal.ai task recovered, ${m[1]} images`],
  [/^导出失败：(.+)$/, (m) => `Export failed: ${m[1]}`],
  [/^导入失败：(.+)$/, (m) => `Import failed: ${m[1]}`],
  [/^保存失败：(.+)$/, (m) => `Save failed: ${m[1]}`],
  [/^加载审计列表失败：(.+)$/, (m) => `Failed to load audit list: ${m[1]}`],
  [/^打开投诉建议失败：(.+)$/, (m) => `Failed to open feedback: ${m[1]}`],
  [/^加入参考图失败：(.+)$/, (m) => `Failed to add reference image: ${m[1]}`],
  [/^服务器审计副本保存失败：(.+)$/, (m) => `Failed to save server audit copy: ${m[1]}`],
  [/^审计图片保存失败：(.+)$/, (m) => `Audit image save failed: ${m[1]}`],
  [/^图集上传失败：(.+)$/, (m) => `Gallery upload failed: ${m[1]}`],
  [/^创建于 (.+)$/, (m) => `Created ${m[1]}`],
  [/^耗时 (.+)$/, (m) => `Duration ${m[1]}`],
  [/^当前：(.+)$/, (m) => `Current: ${m[1]}`],
  [/^例如 (.+)$/, (m) => `e.g. ${m[1]}`],
  [/^OpenAI 最大请求数量为 (\d+)$/, (m) => `OpenAI max request count is ${m[1]}`],
  [/^fal\.ai 最大请求数量为 (\d+)$/, (m) => `fal.ai max request count is ${m[1]}`],
  [/^确定要删除选中的 (\d+) 条记录吗？$/, (m) => `Delete the selected ${m[1]} records?`],
  [/^确定要收藏选中的 (\d+) 条记录吗？$/, (m) => `Favorite the selected ${m[1]} records?`],
  [/^确定要取消收藏选中的 (\d+) 条记录吗？$/, (m) => `Unfavorite the selected ${m[1]} records?`],
]

const textOrigins = new WeakMap<Text, string>()
const attrOrigins = new WeakMap<Element, Map<string, string>>()
let activeLocale: AppLocale = 'zh'
let observer: MutationObserver | null = null
let translating = false

export function normalizeTheme(value: unknown): AppTheme | null {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === 'dark') return 'dark'
  if (raw === 'light') return 'light'
  return null
}

export function normalizeLocale(value: unknown): AppLocale | null {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw.startsWith('en')) return 'en'
  if (raw.startsWith('zh') || raw === 'cn') return 'zh'
  return null
}

export function getCookieValue(name: string) {
  if (typeof document === 'undefined') return ''
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : ''
}

function readPersistedPreferences() {
  if (typeof localStorage === 'undefined') return {}
  try {
    const parsed = JSON.parse(localStorage.getItem(PERSIST_KEY) || '{}') as {
      state?: { theme?: unknown; locale?: unknown }
    }
    return parsed.state ?? {}
  } catch {
    return {}
  }
}

export function getInitialDisplayPreferences() {
  const persisted = readPersistedPreferences()
  return {
    theme: normalizeTheme(getCookieValue(THEME_COOKIE)) ?? normalizeTheme(persisted.theme) ?? 'light',
    locale: normalizeLocale(getCookieValue(LOCALE_COOKIE)) ?? normalizeLocale(persisted.locale) ?? 'zh',
    loginNoticeToken: getCookieValue(LOGIN_NOTICE_COOKIE),
  }
}

export function getLoginNoticeToken() {
  return getCookieValue(LOGIN_NOTICE_COOKIE)
}

export function applyTheme(theme: AppTheme) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
  const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (themeMeta) {
    themeMeta.content = theme === 'dark' ? '#18181b' : '#f8fafc'
  }
}

function setDocumentLocale(locale: AppLocale) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN'
}

function shouldSkipTextNode(node: Text) {
  const parent = node.parentElement
  if (!parent) return true
  return Boolean(parent.closest('script,style,pre,code,kbd,[contenteditable="true"],[data-i18n-skip]'))
}

function translateTextToEnglish(source: string) {
  const exact = exactEn[source]
  if (exact) return exact
  for (const [pattern, replacer] of regexEn) {
    const match = source.match(pattern)
    if (match) return replacer(match)
  }
  return source
}

function translatePreservingOuterWhitespace(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return value
  const translated = activeLocale === 'en' ? translateTextToEnglish(trimmed) : trimmed
  return translated === trimmed ? value : value.replace(trimmed, translated)
}

function translateTextNode(node: Text) {
  if (shouldSkipTextNode(node)) return
  if (!textOrigins.has(node)) {
    textOrigins.set(node, node.nodeValue ?? '')
  }
  const origin = textOrigins.get(node) ?? ''
  const next = activeLocale === 'zh' ? origin : translatePreservingOuterWhitespace(origin)
  if (node.nodeValue !== next) {
    node.nodeValue = next
  }
}

function translateAttr(element: Element, attr: string) {
  if (!element.hasAttribute(attr)) return
  let origins = attrOrigins.get(element)
  if (!origins) {
    origins = new Map()
    attrOrigins.set(element, origins)
  }
  if (!origins.has(attr)) {
    origins.set(attr, element.getAttribute(attr) ?? '')
  }
  const origin = origins.get(attr) ?? ''
  const next = activeLocale === 'zh' ? origin : translatePreservingOuterWhitespace(origin)
  if (element.getAttribute(attr) !== next) {
    element.setAttribute(attr, next)
  }
}

function translateElement(element: Element) {
  translateAttr(element, 'title')
  translateAttr(element, 'aria-label')
  translateAttr(element, 'placeholder')
}

function translateNode(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text)
    return
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return

  const rootElement = root.nodeType === Node.ELEMENT_NODE ? (root as Element) : null
  if (rootElement) translateElement(rootElement)

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) {
      translateTextNode(current as Text)
    } else if (current.nodeType === Node.ELEMENT_NODE) {
      translateElement(current as Element)
    }
    current = walker.nextNode()
  }
}

export function setDomLocale(locale: AppLocale) {
  if (typeof document === 'undefined') return
  activeLocale = locale
  setDocumentLocale(locale)
  translating = true
  try {
    translateNode(document.body)
  } finally {
    translating = false
  }
}

export function installDomTranslationObserver() {
  if (typeof document === 'undefined' || observer) return
  observer = new MutationObserver((mutations) => {
    if (translating) return
    translating = true
    try {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(translateNode)
        } else if (mutation.type === 'attributes') {
          translateNode(mutation.target)
        } else if (mutation.type === 'characterData') {
          translateNode(mutation.target)
        }
      }
    } finally {
      translating = false
    }
  })
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['title', 'aria-label', 'placeholder'],
  })
}
