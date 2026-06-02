/**
 * i18n — UI string catalogue + pure translation helpers (framework-free).
 *
 * Hebrew is the default language; English is the optional alternative. The
 * `en` dictionary is the source of truth for the set of keys (`MessageKey`),
 * and `he` is typed as `Record<MessageKey, string>` so TypeScript guarantees
 * every English key has a Hebrew translation (and vice-versa — no drift).
 *
 * This file is pure and unit-tested (i18n.test.ts). The reactive locale state
 * and the Vue glue live in useI18n.ts.
 */
import type { Locale } from '@shared/types'

/** The locales the UI offers, in display order. Hebrew first (default). */
export const LOCALE_OPTIONS: ReadonlyArray<{ value: Locale; label: string }> = [
  { value: 'he', label: 'עברית' },
  { value: 'en', label: 'English' }
]

/** Hebrew is right-to-left; English is left-to-right. */
export function dirForLocale(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'he' ? 'rtl' : 'ltr'
}

/* ------------------------------------------------------------------ *
 * English — source of truth for the key set.
 * ------------------------------------------------------------------ */
const en = {
  // App shell / header
  'app.tagline': 'Roni · Local-first',
  'app.title': 'Invoice & Receipt Scanner',
  'app.subtitle':
    'Scans your Gmail for invoices and receipts, downloads them locally, and centralises them in one dashboard.',
  'nav.dashboard': 'Dashboard',
  'nav.settings': 'Settings',

  // Backend connectivity card
  'backend.title': 'Backend connectivity',
  'backend.desc':
    'These buttons call the Electron main process over a secure IPC bridge, which reads and writes the local SQLite database.',
  'backend.ping': 'Ping main process',
  'backend.replied': 'main replied:',
  'backend.addSample': 'Add sample invoice',
  'backend.refresh': 'Refresh',
  'backend.rows': 'Rows in local DB:',

  // Scan card
  'scan.title': 'Scan your inbox',
  'scan.desc':
    'Fetch recent Gmail messages, detect invoices & receipts, and download them locally.',
  'scan.now': 'Scan now',
  'scan.scanning': 'Scanning…',
  'scan.scanned': 'Scanned',
  'scan.matched': 'matched',
  'scan.downloaded': 'downloaded',
  'scan.errors': '{count} errors',

  // Invoices table
  'table.title': 'Invoices',
  'table.search': 'Filter by vendor, date, amount…',
  'table.export': 'Export CSV',
  'table.exporting': 'Exporting…',
  'table.exportTitleEmpty': 'Nothing to export',
  'table.exportTitle': 'Export the shown rows to CSV',
  'table.showing': 'Showing {shown} of {total} invoices stored locally.',
  'table.empty': 'No invoices yet — run a scan (or add a sample) to populate the table.',
  'table.noMatch': 'No invoices match “{query}”.',
  'col.date': 'Date',
  'col.vendor': 'Vendor',
  'col.amount': 'Amount',
  'col.foundBy': 'Found by',
  'col.status': 'Status',
  'col.file': 'File',
  'engine.deterministic': 'Deterministic',
  'engine.ai': 'AI',
  'status.pending': 'Pending',
  'status.downloaded': 'Downloaded',
  'status.exported': 'Exported',
  'status.error': 'Error',
  'table.open': 'Open file',
  'table.notDownloaded': 'Not downloaded yet',
  'table.openError': 'Couldn’t open file: {error}',
  'table.exported': 'Exported {count} rows to {path}',

  // Settings — Gmail
  'settings.gmail.title': 'Gmail connection',
  'settings.gmail.connected': 'Connected',
  'settings.gmail.disconnected': 'Disconnected',
  'settings.gmail.account': 'Gmail account',
  'settings.gmail.notConnected': 'Not connected to Gmail',
  'settings.gmail.disconnect': 'Disconnect',
  'settings.gmail.connect': 'Connect Gmail',
  'settings.gmail.connecting': 'Connecting…',
  'settings.gmail.browserHint':
    'A browser window opened — approve access there to finish connecting.',

  // Settings — engine
  'settings.engine.title': 'Default scan engine',
  'settings.engine.desc':
    'Which engine runs by default when you scan. You can change this anytime.',
  'settings.engine.deterministic.label': 'Deterministic',
  'settings.engine.deterministic.desc':
    'Fast local keyword/Regex matching. No API key — fully offline.',
  'settings.engine.ai.label': 'AI (Advanced)',
  'settings.engine.ai.desc':
    'Sends email text to an LLM to classify + extract fields. Requires an API key.',
  'settings.engine.selected': 'Selected',

  // Settings — AI provider + key
  'settings.ai.title': 'AI provider & API key',
  'settings.ai.desc1':
    'The AI engine sends email text to your chosen provider. Your key is stored ',
  'settings.ai.descEmph': 'encrypted on this computer',
  'settings.ai.desc2': ' and never leaves it except to call the provider.',
  'settings.ai.keyLabel': '{provider} API key',
  'settings.ai.placeholderSet': '•••••••• (a key is saved)',
  'settings.ai.placeholderEmpty': 'Paste your API key',
  'settings.ai.save': 'Save',
  'settings.ai.clear': 'Clear',
  'settings.ai.stored': '✓ A key is securely stored for {provider}.',
  'settings.ai.notStored': 'No key stored yet — the AI engine needs one to run.',

  // Settings — language
  'settings.lang.title': 'Language',
  'settings.lang.desc': 'Choose the interface language.'
} as const

/** Every translatable string is addressed by one of these keys. */
export type MessageKey = keyof typeof en

/* ------------------------------------------------------------------ *
 * Hebrew — must cover exactly the same keys (enforced by the type).
 * ------------------------------------------------------------------ */
const he: Record<MessageKey, string> = {
  'app.tagline': 'רוני · מבוסס-מקומי',
  'app.title': 'סורק חשבוניות וקבלות',
  'app.subtitle':
    'סורק את ה-Gmail שלך לאיתור חשבוניות וקבלות, מוריד אותן למחשב ומרכז את כולן בלוח בקרה אחד.',
  'nav.dashboard': 'לוח בקרה',
  'nav.settings': 'הגדרות',

  'backend.title': 'תקשורת עם השרת',
  'backend.desc':
    'הכפתורים האלה קוראים לתהליך הראשי של Electron דרך גשר IPC מאובטח, שקורא וכותב למסד הנתונים המקומי (SQLite).',
  'backend.ping': 'בדיקת תקשורת',
  'backend.replied': 'תשובת השרת:',
  'backend.addSample': 'הוספת חשבונית לדוגמה',
  'backend.refresh': 'רענון',
  'backend.rows': 'שורות במסד הנתונים המקומי:',

  'scan.title': 'סריקת תיבת הדואר',
  'scan.desc': 'משיכת הודעות אחרונות מ-Gmail, זיהוי חשבוניות וקבלות, והורדתן למחשב.',
  'scan.now': 'סרוק עכשיו',
  'scan.scanning': 'סורק…',
  'scan.scanned': 'נסרקו',
  'scan.matched': 'התאמות',
  'scan.downloaded': 'הורדו',
  'scan.errors': '{count} שגיאות',

  'table.title': 'חשבוניות',
  'table.search': 'סינון לפי ספק, תאריך, סכום…',
  'table.export': 'ייצוא ל-CSV',
  'table.exporting': 'מייצא…',
  'table.exportTitleEmpty': 'אין מה לייצא',
  'table.exportTitle': 'ייצוא השורות המוצגות לקובץ CSV',
  'table.showing': 'מציג {shown} מתוך {total} חשבוניות השמורות במחשב.',
  'table.empty': 'אין עדיין חשבוניות — הרץ סריקה (או הוסף דוגמה) כדי למלא את הטבלה.',
  'table.noMatch': 'אין חשבוניות התואמות ל“{query}”.',
  'col.date': 'תאריך',
  'col.vendor': 'ספק',
  'col.amount': 'סכום',
  'col.foundBy': 'זוהה על-ידי',
  'col.status': 'סטטוס',
  'col.file': 'קובץ',
  'engine.deterministic': 'דטרמיניסטי',
  'engine.ai': 'בינה מלאכותית',
  'status.pending': 'ממתין',
  'status.downloaded': 'הורד',
  'status.exported': 'יוצא',
  'status.error': 'שגיאה',
  'table.open': 'פתיחת קובץ',
  'table.notDownloaded': 'טרם הורד',
  'table.openError': 'לא ניתן לפתוח את הקובץ: {error}',
  'table.exported': 'יוצאו {count} שורות אל {path}',

  'settings.gmail.title': 'חיבור ל-Gmail',
  'settings.gmail.connected': 'מחובר',
  'settings.gmail.disconnected': 'מנותק',
  'settings.gmail.account': 'חשבון Gmail',
  'settings.gmail.notConnected': 'לא מחובר ל-Gmail',
  'settings.gmail.disconnect': 'התנתקות',
  'settings.gmail.connect': 'התחברות ל-Gmail',
  'settings.gmail.connecting': 'מתחבר…',
  'settings.gmail.browserHint': 'נפתח חלון דפדפן — אשר/י שם את הגישה כדי להשלים את ההתחברות.',

  'settings.engine.title': 'מנוע סריקה כברירת מחדל',
  'settings.engine.desc': 'איזה מנוע ירוץ כברירת מחדל כשתסרוק. ניתן לשנות זאת בכל עת.',
  'settings.engine.deterministic.label': 'דטרמיניסטי',
  'settings.engine.deterministic.desc':
    'התאמת מילות מפתח/Regex מקומית ומהירה. ללא מפתח API — עובד לחלוטין במצב לא מקוון.',
  'settings.engine.ai.label': 'בינה מלאכותית (מתקדם)',
  'settings.engine.ai.desc': 'שולח את טקסט המייל למודל שפה לצורך סיווג וחילוץ שדות. דורש מפתח API.',
  'settings.engine.selected': 'נבחר',

  'settings.ai.title': 'ספק בינה מלאכותית ומפתח API',
  'settings.ai.desc1': 'מנוע ה-AI שולח את טקסט המייל לספק שבחרת. המפתח שלך נשמר ',
  'settings.ai.descEmph': 'מוצפן על המחשב הזה',
  'settings.ai.desc2': ' ולא עוזב אותו, פרט לקריאה לספק.',
  'settings.ai.keyLabel': 'מפתח API של {provider}',
  'settings.ai.placeholderSet': '•••••••• (מפתח שמור)',
  'settings.ai.placeholderEmpty': 'הדבק/י את מפתח ה-API',
  'settings.ai.save': 'שמירה',
  'settings.ai.clear': 'מחיקה',
  'settings.ai.stored': '✓ מפתח שמור באופן מאובטח עבור {provider}.',
  'settings.ai.notStored': 'אין עדיין מפתח שמור — מנוע ה-AI זקוק לאחד כדי לפעול.',

  'settings.lang.title': 'שפה',
  'settings.lang.desc': 'בחר/י את שפת הממשק.'
}

/** All catalogues, keyed by locale. */
export const messages: Record<Locale, Record<MessageKey, string>> = { en, he }

/**
 * Translate `key` into `locale`, substituting `{name}` placeholders from
 * `params`. Pure — no reactivity. Falls back to the key itself if (somehow)
 * unknown, so a missing string is visible rather than silently blank.
 */
export function translate(
  locale: Locale,
  key: MessageKey,
  params?: Record<string, string | number>
): string {
  const template = messages[locale]?.[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_match, name: string) =>
    name in params ? String(params[name]) : `{${name}}`
  )
}
