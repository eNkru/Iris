/**
 * Dependency-free UI translations (frontend/state-management.md — UI language
 * is appearance state; persisted in localStorage `iris.lang`, default `en`).
 * Plain typed dictionaries: `DictKey` is derived from the `en` dictionary, so
 * a missing `zh` key is a type error. `t()` interpolates `{name}` variables.
 */

export type Lang = "en" | "zh";

export const LANG_VALUES: readonly Lang[] = ["en", "zh"];

export const LANG_STORAGE_KEY = "iris.lang";
export const LANG_COOKIE_NAME = "iris.lang";

const en = {
  // App nav
  "nav.products": "Products",
  "nav.settings": "Settings",
  "nav.signOut": "Sign out",
  "nav.toggleTheme": "Switch to dark mode",
  "nav.toggleTheme.dark": "Switch to light mode",
  "nav.language": "Language",
  "nav.language.en": "English",
  "nav.language.zh": "中文",

  // Home page
  "home.title": "Products",
  "home.intro": "Add a product URL to start tracking its price. The first check runs immediately.",
  "home.tracked": "Tracked products",

  // Add product form
  "addProduct.label": "Product URL",
  "addProduct.placeholder": "https://shop.example.com/product/123",
  "addProduct.empty": "Please enter a product URL.",
  "addProduct.unavailable": "The page was reached but no price could be extracted.",
  "addProduct.failed": "The price check failed.",
  "addProduct.notFound": "The page could not be fetched.",
  "addProduct.error": "Failed to add product.",
  "addProduct.addedChanged": "Added — current price {price} is now tracked.",
  "addProduct.addedUnchanged": "Added — current price is {price}.",
  "addProduct.checking": "Checking…",
  "addProduct.submit": "Add product",

  // Product list
  "productList.loading": "Loading products…",
  "productList.loadError": "Failed to load products.",
  "productList.empty": "No products yet — add your first product URL above.",
  "productList.paused": "Paused",
  "productList.noPrice": "No price recorded yet",
  "productList.checked": " · checked ",
  "productList.checkNow": "Check now",
  "productList.pause": "Pause",
  "productList.resume": "Resume",
  "productList.delete": "Delete",
  "productList.confirmDelete": "Confirm delete",
  "productList.deleting": "Deleting…",
  "productList.cancel": "Cancel",
  "productList.refresh": "Refresh",
  "productList.deleteError": "Failed to delete product.",
  "productList.sendSummary": "Send summary to Telegram",
  "productList.sending": "Sending…",
  "productList.summarySent": "Summary sent to your Telegram ({n} {items})",
  "productList.summarySent.one": "item",
  "productList.summarySent.other": "items",

  // Telegram help tooltip
  "tooltip.title": "How to connect Telegram",
  "tooltip.step1": "Create a bot: message @BotFather and send /newbot, then copy the bot token.",
  "tooltip.step2": "Configure the token: set it in Settings → Global settings (admin) or the TELEGRAM_BOT_TOKEN env var.",
  "tooltip.step3": "Find your chat id: message your bot /start, then the chat id appears in the reply.",
  "tooltip.step4": "Connect: add the chat id under Settings → Alert channels.",
  "tooltip.aria": "Show Telegram setup help",

  // Channels section
  "channels.loading": "Loading channels…",
  "channels.loadError": "Failed to load channels.",
  "channels.addError": "Failed to add channel.",
  "channels.deleteError": "Failed to delete channel.",
  "channels.rowTitle": "Telegram · chat {id}",
  "channels.enabled": "Enabled",
  "channels.disabled": "Disabled",
  "channels.disable": "Disable",
  "channels.enable": "Enable",
  "channels.delete": "Delete",
  "channels.deleting": "Deleting…",
  "channels.empty": "No alert channels yet. Add your Telegram chat id to receive price alerts.",
  "channels.chatIdLabel": "Telegram chat id",
  "channels.chatIdPlaceholder": "e.g. 123456789",
  "channels.chatIdInvalid": "Chat id must be a string of digits.",
  "channels.chatIdHint": "Find your chat id by messaging the bot — you must start the conversation first, because the bot can't message you until you do. Send it /start and use its reply, or ask @userinfobot. Example:",
  "channels.adding": "Adding…",
  "channels.add": "Add channel",
  "channels.languageLabel": "Notification language",
  "channels.language.en": "English",
  "channels.language.zh": "中文",

  // User settings
  "userSettings.loading": "Loading settings…",
  "userSettings.loadError": "Failed to load settings.",
  "userSettings.saveError": "Failed to save settings.",
  "userSettings.intervalLabel": "Default poll interval (minutes)",
  "userSettings.intervalPlaceholder": "Empty = use instance default",
  "userSettings.intervalInvalid": "Poll interval must be a whole number of minutes (or empty).",
  "userSettings.intervalHint": "Applied to new products and products without their own interval.",
  "userSettings.saved": "Saved.",
  "userSettings.saving": "Saving…",
  "userSettings.submit": "Save settings",

  // Admin settings
  "adminSettings.loading": "Loading global settings…",
  "adminSettings.loadError": "Failed to load global settings.",
  "adminSettings.saveError": "Failed to save global settings.",
  "adminSettings.aiBaseUrlLabel": "AI base URL",
  "adminSettings.aiBaseUrlPlaceholder": "https://api.openai.com/v1",
  "adminSettings.aiBaseUrlHint": "Any OpenAI-compatible endpoint (OpenAI, OpenRouter, OpenCode Zen, a local Llama/Ollama server, etc.).",
  "adminSettings.aiBaseUrlInvalid": "AI base URL must be a valid URL (e.g. https://api.openai.com/v1).",
  "adminSettings.aiApiKeyLabel": "AI API key",
  "adminSettings.aiApiKeyPlaceholder": "Leave empty to keep the stored key",
  "adminSettings.aiApiKeyStored": "Stored key: {key}",
  "adminSettings.aiApiKeyNone": "No key stored.",
  "adminSettings.aiModelLabel": "AI model",
  "adminSettings.aiModelPlaceholder": "e.g. gpt-4o-mini, deepseek-v4-flash-free, llama3.1",
  "adminSettings.aiModelHint": "Must support tool calling (the model fetches the product page itself).",
  "adminSettings.intervalLabel": "Default poll interval (minutes)",
  "adminSettings.intervalInvalid": "Poll interval must be a whole number of minutes.",
  "adminSettings.intervalHint": "Instance default; users and products can override it.",
  "adminSettings.botTokenLabel": "Telegram bot token",
  "adminSettings.botTokenPlaceholder": "Leave empty to keep the stored token",
  "adminSettings.botTokenStored": "Stored token: {token}",
  "adminSettings.botTokenNone": "No token stored.",
  "adminSettings.saved": "Saved.",
  "adminSettings.saving": "Saving…",
  "adminSettings.submit": "Save global settings",

  // Product edit form
  "editForm.intervalLabel": "Poll interval (minutes)",
  "editForm.intervalPlaceholder": "Empty = use default",
  "editForm.intervalHint": "How often the background scheduler checks this product.",
  "editForm.intervalInvalid": "Poll interval must be a whole number of minutes (or empty for the default).",
  "editForm.anyChange": "Alert on any price change",
  "editForm.risePct": "Rise threshold (%)",
  "editForm.fallPct": "Fall threshold (%)",
  "editForm.riseAbs": "Rise threshold (abs)",
  "editForm.fallAbs": "Fall threshold (abs)",
  "editForm.thresholdsHint": "Thresholds are direction-specific. Blank thresholds + \"any change\" off = no alerts.",
  "editForm.silent": "No alert rules are active — price changes for this product won't send notifications.",
  "editForm.saveError": "Failed to save product settings.",
  "editForm.saved": "Saved.",
  "editForm.saving": "Saving…",
  "editForm.saveChanges": "Save changes",
  "editForm.pause": "Pause tracking",
  "editForm.resume": "Resume tracking",

  // Price chart
  "chart.empty": "No price changes in the selected period.",
  "chart.emptyHint": "Readings are only recorded when the price changes.",
  "chart.range": "Range",
  "chart.rangeAria": "Chart range",
  "chart.7d": "7 days",
  "chart.30d": "30 days",
  "chart.all": "All",
  "chart.price": "Price",
  "chart.priceWithCurrency": "Price ({currency})",

  // Auth gate
  "authGate.loading": "Loading…",

  // Login
  "login.emailLabel": "Email address",
  "login.emailPlaceholder": "you@example.com",
  "login.emailEmpty": "Please enter your email address.",
  "login.sendError": "Failed to send the login link.",
  "login.sent": "We sent a login link to {email}. Check your inbox — if it isn't there in a minute, check your spam or junk folder.",
  "login.resend": "Resend link",
  "login.differentEmail": "Use a different email",
  "login.sending": "Sending…",
  "login.sendLink": "Send login link",
  "login.brand": "Iris",
  "login.tagline": "Price tracking & alerts. Enter your email and we'll send you a sign-in link.",

  // Settings page
  "settings.title": "Settings",
  "settings.signedInAs": "Signed in as {email}{admin}.",
  "settings.adminSuffix": " (admin)",
  "settings.alertChannels": "Alert channels",
  "settings.yourSettings": "Your settings",
  "settings.globalAdmin": "Global settings (admin)",

  // Product detail
  "detail.loading": "Loading product…",
  "detail.loadError": "Failed to load product.",
  "detail.back": "← Back to products",
  "detail.currentPrice": "Current price: {price}",
  "detail.noPrice": "No price recorded yet",
  "detail.lastChecked": "Last checked: {time}",
  "detail.active": "Active",
  "detail.paused": "Paused",
  "detail.checking": "Checking…",
  "detail.checkNow": "Check now",
  "detail.priceChanged": "Price changed: {prices}{alert}",
  "detail.alertSent": " (alert sent)",
  "detail.priceUnchanged": "Price unchanged ({price}).",
  "detail.unavailable": "Page reached but no price could be extracted.",
  "detail.checkFailed": "Check failed: {reason}",
  "detail.priceHistory": "Price history",
  "detail.settings": "Settings",
} as const;

export type DictKey = keyof typeof en;

type Dictionary = Record<DictKey, string>;

const zh: Dictionary = {
  // App nav
  "nav.products": "商品",
  "nav.settings": "设置",
  "nav.signOut": "退出登录",
  "nav.toggleTheme": "切换到深色模式",
  "nav.toggleTheme.dark": "切换到浅色模式",
  "nav.language": "语言",
  "nav.language.en": "English",
  "nav.language.zh": "中文",

  // Home page
  "home.title": "商品",
  "home.intro": "添加商品链接即可开始追踪价格，首次检查会立即执行。",
  "home.tracked": "追踪中的商品",

  // Add product form
  "addProduct.label": "商品链接",
  "addProduct.placeholder": "https://shop.example.com/product/123",
  "addProduct.empty": "请输入商品链接。",
  "addProduct.unavailable": "页面可访问，但未能提取到价格。",
  "addProduct.failed": "价格检查失败。",
  "addProduct.notFound": "无法获取该页面。",
  "addProduct.error": "添加商品失败。",
  "addProduct.addedChanged": "已添加 — 当前价格 {price} 已开始追踪。",
  "addProduct.addedUnchanged": "已添加 — 当前价格为 {price}。",
  "addProduct.checking": "检查中…",
  "addProduct.submit": "添加商品",

  // Product list
  "productList.loading": "正在加载商品…",
  "productList.loadError": "加载商品失败。",
  "productList.empty": "还没有商品 — 先在上方添加第一个商品链接。",
  "productList.paused": "已暂停",
  "productList.noPrice": "暂无价格记录",
  "productList.checked": " · 检查于 ",
  "productList.checkNow": "立即检查",
  "productList.pause": "暂停",
  "productList.resume": "恢复",
  "productList.delete": "删除",
  "productList.confirmDelete": "确认删除",
  "productList.deleting": "删除中…",
  "productList.cancel": "取消",
  "productList.refresh": "刷新",
  "productList.deleteError": "删除商品失败。",
  "productList.sendSummary": "发送摘要到 Telegram",
  "productList.sending": "发送中…",
  "productList.summarySent": "摘要已发送到你的 Telegram（{n} {items}）",
  "productList.summarySent.one": "个商品",
  "productList.summarySent.other": "个商品",

  // Telegram help tooltip
  "tooltip.title": "如何连接 Telegram",
  "tooltip.step1": "创建机器人：给 @BotFather 发送 /newbot，然后复制机器人令牌。",
  "tooltip.step2": "配置令牌：在设置 → 全局设置（管理员）或 TELEGRAM_BOT_TOKEN 环境变量中填写。",
  "tooltip.step3": "获取聊天 ID：给你的机器人发送 /start，回复中会显示聊天 ID。",
  "tooltip.step4": "连接：在设置 → 提醒频道中添加聊天 ID。",
  "tooltip.aria": "显示 Telegram 配置帮助",

  // Channels section
  "channels.loading": "正在加载频道…",
  "channels.loadError": "加载频道失败。",
  "channels.addError": "添加频道失败。",
  "channels.deleteError": "删除频道失败。",
  "channels.rowTitle": "Telegram · chat {id}",
  "channels.enabled": "已启用",
  "channels.disabled": "已停用",
  "channels.disable": "停用",
  "channels.enable": "启用",
  "channels.delete": "删除",
  "channels.deleting": "删除中…",
  "channels.empty": "还没有提醒频道。添加你的 Telegram 聊天 ID 即可接收价格提醒。",
  "channels.chatIdLabel": "Telegram 聊天 ID",
  "channels.chatIdPlaceholder": "例如 123456789",
  "channels.chatIdInvalid": "聊天 ID 必须是一串数字。",
  "channels.chatIdHint": "通过给机器人发消息来获取聊天 ID —— 你必须先发起对话，因为机器人只有在你先发消息后才能联系你。给它发 /start 并使用回复，或询问 @userinfobot。示例：",
  "channels.adding": "添加中…",
  "channels.add": "添加频道",
  "channels.languageLabel": "通知语言",
  "channels.language.en": "English",
  "channels.language.zh": "中文",

  // User settings
  "userSettings.loading": "正在加载设置…",
  "userSettings.loadError": "加载设置失败。",
  "userSettings.saveError": "保存设置失败。",
  "userSettings.intervalLabel": "默认轮询间隔（分钟）",
  "userSettings.intervalPlaceholder": "留空 = 使用实例默认值",
  "userSettings.intervalInvalid": "轮询间隔必须为整数分钟（或留空）。",
  "userSettings.intervalHint": "适用于新商品以及未单独设置间隔的商品。",
  "userSettings.saved": "已保存。",
  "userSettings.saving": "保存中…",
  "userSettings.submit": "保存设置",

  // Admin settings
  "adminSettings.loading": "正在加载全局设置…",
  "adminSettings.loadError": "加载全局设置失败。",
  "adminSettings.saveError": "保存全局设置失败。",
  "adminSettings.aiBaseUrlLabel": "AI 基础 URL",
  "adminSettings.aiBaseUrlPlaceholder": "https://api.openai.com/v1",
  "adminSettings.aiBaseUrlHint": "任何兼容 OpenAI 的端点（OpenAI、OpenRouter、OpenCode Zen、本地 Llama/Ollama 服务器等）。",
  "adminSettings.aiBaseUrlInvalid": "AI 基础 URL 必须是有效 URL（例如 https://api.openai.com/v1）。",
  "adminSettings.aiApiKeyLabel": "AI API 密钥",
  "adminSettings.aiApiKeyPlaceholder": "留空以保留已存储的密钥",
  "adminSettings.aiApiKeyStored": "已存储密钥：{key}",
  "adminSettings.aiApiKeyNone": "未存储密钥。",
  "adminSettings.aiModelLabel": "AI 模型",
  "adminSettings.aiModelPlaceholder": "例如 gpt-4o-mini、deepseek-v4-flash-free、llama3.1",
  "adminSettings.aiModelHint": "必须支持工具调用（模型需要自行抓取商品页面）。",
  "adminSettings.intervalLabel": "默认轮询间隔（分钟）",
  "adminSettings.intervalInvalid": "轮询间隔必须为整数分钟。",
  "adminSettings.intervalHint": "实例默认值；用户和商品可单独覆盖。",
  "adminSettings.botTokenLabel": "Telegram 机器人令牌",
  "adminSettings.botTokenPlaceholder": "留空以保留已存储的令牌",
  "adminSettings.botTokenStored": "已存储令牌：{token}",
  "adminSettings.botTokenNone": "未存储令牌。",
  "adminSettings.saved": "已保存。",
  "adminSettings.saving": "保存中…",
  "adminSettings.submit": "保存全局设置",

  // Product edit form
  "editForm.intervalLabel": "轮询间隔（分钟）",
  "editForm.intervalPlaceholder": "留空 = 使用默认值",
  "editForm.intervalHint": "后台调度器检查该商品的频率。",
  "editForm.intervalInvalid": "轮询间隔必须为整数分钟（或留空使用默认值）。",
  "editForm.anyChange": "价格任何变动都提醒",
  "editForm.risePct": "涨幅阈值（%）",
  "editForm.fallPct": "跌幅阈值（%）",
  "editForm.riseAbs": "涨幅阈值（绝对）",
  "editForm.fallAbs": "跌幅阈值（绝对）",
  "editForm.thresholdsHint": "阈值为方向性配置。阈值留空且“任何变动”关闭 = 不提醒。",
  "editForm.silent": "当前没有生效的提醒规则 — 该商品的价格变动不会发送通知。",
  "editForm.saveError": "保存商品设置失败。",
  "editForm.saved": "已保存。",
  "editForm.saving": "保存中…",
  "editForm.saveChanges": "保存更改",
  "editForm.pause": "暂停追踪",
  "editForm.resume": "恢复追踪",

  // Price chart
  "chart.empty": "所选时段内没有价格变动。",
  "chart.emptyHint": "只有在价格变化时才会记录读数。",
  "chart.range": "范围",
  "chart.rangeAria": "图表范围",
  "chart.7d": "7 天",
  "chart.30d": "30 天",
  "chart.all": "全部",
  "chart.price": "价格",
  "chart.priceWithCurrency": "价格（{currency}）",

  // Auth gate
  "authGate.loading": "加载中…",

  // Login
  "login.emailLabel": "邮箱地址",
  "login.emailPlaceholder": "you@example.com",
  "login.emailEmpty": "请输入你的邮箱地址。",
  "login.sendError": "发送登录链接失败。",
  "login.sent": "我们已向 {email} 发送登录链接。请查收收件箱 —— 如果一分钟后仍未收到，请检查垃圾邮件文件夹。",
  "login.resend": "重新发送链接",
  "login.differentEmail": "使用其他邮箱",
  "login.sending": "发送中…",
  "login.sendLink": "发送登录链接",
  "login.brand": "Iris",
  "login.tagline": "价格追踪与提醒。输入你的邮箱，我们会发送一条登录链接。",

  // Settings page
  "settings.title": "设置",
  "settings.signedInAs": "已登录：{email}{admin}。",
  "settings.adminSuffix": "（管理员）",
  "settings.alertChannels": "提醒频道",
  "settings.yourSettings": "你的设置",
  "settings.globalAdmin": "全局设置（管理员）",

  // Product detail
  "detail.loading": "正在加载商品…",
  "detail.loadError": "加载商品失败。",
  "detail.back": "← 返回商品列表",
  "detail.currentPrice": "当前价格：{price}",
  "detail.noPrice": "暂无价格记录",
  "detail.lastChecked": "上次检查：{time}",
  "detail.active": "活跃",
  "detail.paused": "已暂停",
  "detail.checking": "检查中…",
  "detail.checkNow": "立即检查",
  "detail.priceChanged": "价格已变动：{prices}{alert}",
  "detail.alertSent": "（已发送提醒）",
  "detail.priceUnchanged": "价格未变动（{price}）。",
  "detail.unavailable": "页面可访问，但未能提取到价格。",
  "detail.checkFailed": "检查失败：{reason}",
  "detail.priceHistory": "价格历史",
  "detail.settings": "设置",
};

const dictionaries: Record<Lang, Dictionary> = { en, zh };

/**
 * Translate a key. `vars` interpolates `{name}` placeholders in the template.
 * Unknown keys are compile-time errors (`DictKey`); missing vars render empty.
 */
export function t(lang: Lang, key: DictKey, vars?: Record<string, string | number>): string {
  const template: string = dictionaries[lang][key];
  if (!vars) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}
