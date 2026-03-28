"""
Generates preview images for all three story themes using sample data.
Run: python scripts/preview_story.py
"""

import os
from ig_stories import THEMES, _ensure_fonts, generate_story

SAMPLE = {
    "title":     "Balleremo Open Night",
    "date_str":  "Sat 5 Apr",
    "time_str":  "22:00",
    "location":  "Via Rimini 38, Milano",
    "organizer": "@balleremo_",
}

if __name__ == "__main__":
    _ensure_fonts()
    base = os.path.dirname(__file__)
    for i, theme in enumerate(THEMES, 1):
        out  = os.path.join(base, f"story_preview_{i}_{theme['name']}.jpg")
        data = generate_story(theme, SAMPLE, event_img=None)
        with open(out, "wb") as f:
            f.write(data)
        print(f"Saved: {out}")
