"""
ig_stories.py
-------------
Generates and posts three branded Instagram Story variations for each
unpromotted Alba event post, then publishes them sequentially to
@albaappofficial via the Instagram Graph API.

Workflow:
  1. Load promoted_stories.json to find which posts have already been promoted.
  2. Query Supabase `posts` table for Event posts not yet promoted.
  3. For each post, download the event image from Supabase Storage.
  4. Generate three 1080x1920 story images (dark / light-blue / white themes).
  5. Upload each story to Supabase Storage (alba-media/stories/).
  6. Post the three stories sequentially to Instagram via the Graph API.
  7. Mark the post as promoted in promoted_stories.json.

Requirements:
    pip install pillow requests supabase python-dotenv

.env vars needed:
    IG_BUSINESS_ACCOUNT_ID  : numeric Instagram user ID (17841468984869786)
    IG_ACCESS_TOKEN         : long-lived access token (refresh every ~60 days)
    EXPO_PUBLIC_SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import os
import io
import sys
import uuid
import json
import time
import datetime
import requests
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from dotenv import load_dotenv
from supabase import create_client, Client

# ── Load env ──────────────────────────────────────────────────────────────────
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

# ── CONFIG ────────────────────────────────────────────────────────────────────
SUPABASE_URL   = os.getenv("EXPO_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY   = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
IG_ACCOUNT_ID  = os.getenv("IG_BUSINESS_ACCOUNT_ID", "")
IG_TOKEN       = os.getenv("IG_ACCESS_TOKEN", "")
SCRIPTS_DIR    = os.path.dirname(__file__)
FONTS_DIR      = os.path.join(SCRIPTS_DIR, "fonts")
PROMOTED_FILE  = os.path.join(SCRIPTS_DIR, "promoted_stories.json")
ICON_WHITE     = os.path.join(SCRIPTS_DIR, "..", "assets", "icon_white.png")
ICON_BLUE      = os.path.join(SCRIPTS_DIR, "..", "assets", "icon_blue.png")
STORAGE_BUCKET = "alba-media"
W, H           = 1080, 1920
# ─────────────────────────────────────────────────────────────────────────────

BRAND_BLUE = (0, 174, 255)
WHITE      = (255, 255, 255)
DARK_NAVY  = (10, 30, 70)

THEMES = [
    {
        "name":          "dark",
        "bg_top":        (10, 15, 25),
        "bg_bottom":     (15, 35, 80),
        "overlay_alpha": 155,
        "card_top":      (20, 30, 65),
        "card_bottom":   (12, 20, 50),
        "wordmark":      WHITE,
        "icon":          ICON_WHITE,
        "title":         WHITE,
        "date":          BRAND_BLUE,
        "location":      WHITE,
        "organizer":     (148, 163, 184),
        "cta":           BRAND_BLUE,
        "line":          WHITE,
        "tagline":       WHITE,
    },
    {
        "name":          "light_blue",
        "bg_top":        (185, 230, 255),
        "bg_bottom":     (100, 180, 240),
        "overlay_alpha": 30,
        "card_top":      (110, 170, 225),
        "card_bottom":   (65, 130, 200),
        "wordmark":      DARK_NAVY,
        "icon":          ICON_BLUE,
        "title":         DARK_NAVY,
        "date":          (0, 100, 200),
        "location":      DARK_NAVY,
        "organizer":     (50, 85, 140),
        "cta":           (0, 90, 185),
        "line":          DARK_NAVY,
        "tagline":       (50, 85, 140),
    },
    {
        "name":          "white",
        "bg_top":        (255, 255, 255),
        "bg_bottom":     (220, 242, 255),
        "overlay_alpha": 0,
        "card_top":      (210, 230, 248),
        "card_bottom":   (175, 210, 240),
        "wordmark":      DARK_NAVY,
        "icon":          ICON_BLUE,
        "title":         DARK_NAVY,
        "date":          BRAND_BLUE,
        "location":      DARK_NAVY,
        "organizer":     (100, 120, 150),
        "cta":           BRAND_BLUE,
        "line":          (180, 200, 220),
        "tagline":       (120, 145, 175),
    },
]


# ── Font helpers ──────────────────────────────────────────────────────────────

def _ensure_fonts():
    os.makedirs(FONTS_DIR, exist_ok=True)
    urls = {
        "Poppins-Bold.ttf":     "https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-Bold.ttf",
        "Poppins-SemiBold.ttf": "https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-SemiBold.ttf",
        "Poppins-Regular.ttf":  "https://github.com/google/fonts/raw/main/ofl/poppins/Poppins-Regular.ttf",
    }
    for name, url in urls.items():
        path = os.path.join(FONTS_DIR, name)
        if not os.path.exists(path):
            print(f"Downloading font {name}...")
            r = requests.get(url, timeout=15)
            with open(path, "wb") as fh:
                fh.write(r.content)


def _f(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(os.path.join(FONTS_DIR, name), size)


def _wrap(text: str, fnt, max_w: int, draw: ImageDraw.ImageDraw) -> list[str]:
    words = text.split()
    lines, line = [], ""
    for word in words:
        test = (line + " " + word).strip()
        if draw.textlength(test, font=fnt) <= max_w:
            line = test
        else:
            if line:
                lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines[:2]


# ── Image generation ──────────────────────────────────────────────────────────

def _gradient(top: tuple, bottom: tuple, w: int = W, h: int = H) -> Image.Image:
    img  = Image.new("RGB", (w, h))
    draw = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        draw.line(
            [(0, y), (w, y)],
            fill=(
                int(top[0] + t * (bottom[0] - top[0])),
                int(top[1] + t * (bottom[1] - top[1])),
                int(top[2] + t * (bottom[2] - top[2])),
            ),
        )
    return img


def _card(event_img: Image.Image | None, theme: dict, size: int, radius: int) -> Image.Image:
    if event_img:
        img      = event_img.convert("RGB")
        min_side = min(img.width, img.height)
        left     = (img.width  - min_side) // 2
        top      = (img.height - min_side) // 2
        img      = img.crop((left, top, left + min_side, top + min_side))
        img      = img.resize((size, size), Image.LANCZOS)
    else:
        img = _gradient(theme["card_top"], theme["card_bottom"], size, size)

    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size, size], radius=radius, fill=255)
    result = img.convert("RGBA")
    result.putalpha(mask)
    return result


def generate_story(theme: dict, post_data: dict, event_img: Image.Image | None) -> bytes:
    """
    Renders one 1080x1920 story image and returns it as JPEG bytes.

    post_data keys: title, date_str, time_str, location, organizer
    """
    # Background
    canvas = _gradient(theme["bg_top"], theme["bg_bottom"])
    if theme["overlay_alpha"] > 0:
        overlay = Image.new("RGBA", (W, H), (0, 0, 0, theme["overlay_alpha"]))
        canvas  = Image.alpha_composite(canvas.convert("RGBA"), overlay).convert("RGB")

    draw   = ImageDraw.Draw(canvas)
    margin = 64

    # Icon + wordmark (top-right, below device status bar)
    icon_top = 160
    icon_h   = 70
    icon_mid = icon_top + icon_h // 2
    fnt_wm   = _f("Poppins-Bold.ttf", 66)
    wm_text  = "alba"
    wm_w     = int(draw.textlength(wm_text, font=fnt_wm))
    icon_w_final = 0
    try:
        icon   = Image.open(theme["icon"]).convert("RGBA")
        icon_w_final = int(icon.width * (icon_h / icon.height))
        icon   = icon.resize((icon_w_final, icon_h), Image.LANCZOS)
        # Right-align: icon starts at W - margin - icon_w - 16 - wm_w
        icon_x = W - margin - icon_w_final - 16 - wm_w
        canvas.paste(icon, (icon_x, icon_top), icon)
        text_x = icon_x + icon_w_final + 16
    except Exception:
        text_x = W - margin - wm_w
    draw.text((text_x, icon_mid), wm_text, font=fnt_wm,
              fill=theme["wordmark"], anchor="lm")

    # Event image card
    card_size   = 920
    card_x      = (W - card_size) // 2
    card_y      = 280
    card_radius = 40
    card        = _card(event_img, theme, card_size, card_radius)
    canvas.paste(card, (card_x, card_y), card)

    # Text block
    text_y = card_y + card_size + 60

    fnt_title = _f("Poppins-Bold.ttf", 64)
    for line in _wrap(post_data["title"], fnt_title, W - margin * 2, draw):
        draw.text((margin, text_y), line, font=fnt_title, fill=theme["title"])
        text_y += 78
    text_y += 10

    date_str = post_data["date_str"]
    if post_data.get("time_str"):
        date_str += f"  ·  {post_data['time_str']}"
    draw.text((margin, text_y), date_str, font=_f("Poppins-SemiBold.ttf", 46), fill=theme["date"])
    text_y += 62

    draw.text((margin, text_y), post_data["location"] or "", font=_f("Poppins-Regular.ttf", 42),
              fill=theme["location"])
    text_y += 58 + 20

    draw.text((margin, text_y), f"event by {post_data['organizer']}",
              font=_f("Poppins-Regular.ttf", 36), fill=theme["organizer"])

    # CTA (two lines, centred)
    fnt_cta  = _f("Poppins-SemiBold.ttf", 44)
    cta_l1   = "more events on"
    cta_l2   = "the alba app"
    cta_l1_w = draw.textlength(cta_l1, font=fnt_cta)
    cta_l2_w = draw.textlength(cta_l2, font=fnt_cta)
    cta_w    = max(cta_l1_w, cta_l2_w)  # used for decorative lines
    cta_y    = H - 200
    line_spacing = 54
    draw.text(((W - cta_l1_w) // 2, cta_y),               cta_l1, font=fnt_cta, fill=theme["cta"])
    draw.text(((W - cta_l2_w) // 2, cta_y + line_spacing), cta_l2, font=fnt_cta, fill=theme["cta"])

    # Decorative lines: flank the wider text line, sitting in the gap between the two CTA lines
    line_y    = cta_y + line_spacing // 2 + 10
    gap       = 18
    wider_w   = max(cta_l1_w, cta_l2_w)
    inner_l   = (W - wider_w) // 2        # left edge of centered text block
    inner_r   = inner_l + wider_w          # right edge
    draw.line([(margin, line_y), (inner_l - gap, line_y)], fill=theme["line"], width=2)
    draw.line([(inner_r + gap, line_y), (W - margin, line_y)], fill=theme["line"], width=2)

    fnt_tag = _f("Poppins-Regular.ttf", 30)
    tagline = "social media, without the toxic part."
    tag_w   = draw.textlength(tagline, font=fnt_tag)
    draw.text(((W - tag_w) // 2, cta_y + line_spacing * 2 + 24), tagline, font=fnt_tag, fill=theme["tagline"])

    buf = io.BytesIO()
    canvas.save(buf, "JPEG", quality=95)
    return buf.getvalue()


# ── Promoted stories tracking ─────────────────────────────────────────────────

def _load_promoted() -> dict:
    if os.path.exists(PROMOTED_FILE):
        with open(PROMOTED_FILE, encoding="utf-8") as fh:
            return json.load(fh)
    return {}


def _save_promoted(data: dict) -> None:
    with open(PROMOTED_FILE, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)


# ── Instagram Graph API ───────────────────────────────────────────────────────

def _check_token_expiry():
    resp = requests.get(
        "https://graph.facebook.com/v19.0/debug_token",
        params={
            "input_token":  IG_TOKEN,
            "access_token": IG_TOKEN,
        },
        timeout=10,
    ).json()
    exp = resp.get("data", {}).get("data_access_expires_at") or \
          resp.get("data", {}).get("expires_at")
    if exp:
        days_left = (datetime.datetime.fromtimestamp(exp) - datetime.datetime.now()).days
        if days_left < 7:
            print(f"  [!] WARNING: IG access token expires in {days_left} day(s). Refresh it soon.")
        else:
            print(f"  Token valid for ~{days_left} more days.")


def _post_story(image_url: str, mention_username: str | None = None) -> bool:
    """Creates a Story media container and publishes it. Returns True on success."""
    # Step 1: create container
    params: dict = {
        "image_url":    image_url,
        "media_type":   "STORIES",
        "access_token": IG_TOKEN,
    }
    if mention_username:
        # Best-effort: tag the organizer at centre of the story
        clean = mention_username.lstrip("@")
        params["user_tags"] = json.dumps([{"username": clean, "x": 0.5, "y": 0.5}])
    r = requests.post(
        f"https://graph.facebook.com/v19.0/{IG_ACCOUNT_ID}/media",
        params=params,
        timeout=30,
    )
    data = r.json()
    if "id" not in data:
        print(f"  [!] Media container error: {data}")
        return False
    creation_id = data["id"]

    time.sleep(3)

    # Step 2: publish
    r2 = requests.post(
        f"https://graph.facebook.com/v19.0/{IG_ACCOUNT_ID}/media_publish",
        params={
            "creation_id":  creation_id,
            "access_token": IG_TOKEN,
        },
        timeout=30,
    )
    data2 = r2.json()
    if "id" not in data2:
        print(f"  [!] Publish error: {data2}")
        return False
    return True


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    # Optional: --organizer @handle overrides the organizer tag for this run
    organizer_override = None
    if "--organizer" in sys.argv:
        idx = sys.argv.index("--organizer")
        if idx + 1 < len(sys.argv):
            organizer_override = sys.argv[idx + 1]
            if not organizer_override.startswith("@"):
                organizer_override = f"@{organizer_override}"
            print(f"Organizer override: {organizer_override}\n")

    missing = [k for k, v in {
        "SUPABASE_URL":          SUPABASE_URL,
        "SUPABASE_KEY":          SUPABASE_KEY,
        "IG_BUSINESS_ACCOUNT_ID": IG_ACCOUNT_ID,
        "IG_ACCESS_TOKEN":       IG_TOKEN,
    }.items() if not v]
    if missing:
        print(f"[ERROR] Missing config: {', '.join(missing)}")
        return

    _ensure_fonts()
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

    print("Checking token expiry...")
    _check_token_expiry()

    # Fix 5: build the set of alba usernames that were scraped from Instagram
    # (i.e., the alba_user column values in handles.csv)
    scraped_users: set[str] = set()
    handles_csv = os.path.join(SCRIPTS_DIR, "handles.csv")
    if os.path.exists(handles_csv):
        import csv
        with open(handles_csv, encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                if row.get("alba_user"):
                    scraped_users.add(row["alba_user"].strip())

    # Also include any user whose posts appear in processed_posts.json
    processed_file = os.path.join(SCRIPTS_DIR, "processed_posts.json")
    if os.path.exists(processed_file):
        with open(processed_file, encoding="utf-8") as fh:
            for handle in json.load(fh).keys():
                scraped_users.add(handle.strip())

    print(f"Scraped organizer accounts: {sorted(scraped_users)}")

    # Fetch unpromoted Event posts
    promoted  = _load_promoted()
    all_posts = supabase.table("posts").select(
        "id, title, date, time, location, user, postmediauri, thumbnail_url, author_id"
    ).eq("type", "Event").execute().data

    # Only promote posts whose author is a scraped organizer
    pending = [
        p for p in all_posts
        if p["id"] not in promoted and p.get("user") in scraped_users
    ]
    print(f"\n{len(pending)} post(s) to promote (out of {len(all_posts)} total events).\n")

    # Fix 3: cycle theme index across events (stored in promoted dict)
    theme_index = promoted.get("__theme_index", 0)

    for post in pending:
        title    = post.get("title") or "Alba Event"
        date_str = post.get("date") or ""
        time_str = post.get("time") or ""
        location = post.get("location") or ""
        organizer = organizer_override or f"@{post.get('user') or 'alba'}"

        # Fix 4: the real IG username to mention (strip @ for the API call)
        mention_user = organizer_override or post.get("user") or None

        # Format date nicely (e.g. "2026-04-05" → "Sat 5 Apr")
        try:
            d = datetime.date.fromisoformat(date_str)
            date_display = d.strftime("%a %-d %b") if os.name != "nt" else d.strftime("%a %#d %b")
        except Exception:
            date_display = date_str

        post_data = {
            "title":    title,
            "date_str": date_display,
            "time_str": time_str,
            "location": location,
            "organizer": organizer,
        }

        # Fix 3: pick one theme for this event, advance index
        theme = THEMES[theme_index % len(THEMES)]
        theme_index += 1

        print(f"── {title} ({date_display}) [theme: {theme['name']}] ──────────────────────────────────────")

        # Download event image
        event_img = None
        media_urls = post.get("postmediauri") or []
        thumb_url  = post.get("thumbnail_url")
        img_url    = (media_urls[0] if media_urls else None) or thumb_url
        if img_url:
            try:
                resp = requests.get(img_url, timeout=20)
                resp.raise_for_status()
                event_img = Image.open(io.BytesIO(resp.content))
                print(f"  Image loaded ({event_img.width}×{event_img.height})")
            except Exception as e:
                print(f"  [!] Could not load image: {e} — using placeholder")

        # Generate and upload the single chosen theme
        print(f"  Generating {theme['name']} variant...", end=" ")
        jpeg_bytes = generate_story(theme, post_data, event_img)
        storage_path = f"stories/{post['id']}/{theme['name']}.jpg"
        story_url = None
        try:
            supabase.storage.from_(STORAGE_BUCKET).upload(
                storage_path, jpeg_bytes,
                {"content-type": "image/jpeg", "upsert": "true"}
            )
            story_url = supabase.storage.from_(STORAGE_BUCKET).get_public_url(storage_path)
            print(f"uploaded ✓")
        except Exception as e:
            print(f"upload failed: {e}")

        if not story_url:
            print(f"  [!] Skipping post — no story URL.\n")
            continue

        # Fix 4: post with organizer mention
        print(f"  Posting story (mention: {mention_user})...", end=" ")
        ok = _post_story(story_url, mention_username=mention_user)
        print("✓" if ok else "✗")

        if ok:
            promoted[post["id"]] = {
                "title":    title,
                "theme":    theme["name"],
                "promoted": datetime.datetime.utcnow().isoformat(),
            }
            promoted["__theme_index"] = theme_index
            _save_promoted(promoted)
            print(f"  Marked as promoted.\n")
        else:
            print(f"  [!] Not marking as promoted — story failed.\n")


if __name__ == "__main__":
    main()
