# Keenest apps — app.keenest.co.il

כל אתרי קינסט שעברו מ-Claude לאתר של קינסט. כל אתר בתיקייה משלו:

- `tazrim-bayit/` — תזרים הבית
- `tazrim/` — תזרים קינסט

איך זה עובד:
- `shared/bridge.js` — כניסה (אותם שמות וקודים כמו בשעון), נתונים ב-Supabase, ופעולות של Claude וחיבורים (Notion, Financy, Morning...) שרצות על המחשב במשרד.
- `worker/` — "העובד" שרץ על המק במשרד ומריץ את הפעולות עם Claude Code (לא עולה לאתר).
- `tools/port.py` — הופך אתר שנבנה כ-artifact של Claude לאתר כאן.

Hostinger מושך את המאגר הזה אוטומטית לתיקייה של app.keenest.co.il בכל עדכון.
