"""
ig_to_supabase.py
-----------------
Scrapes Instagram posts from a list of handles via Apify,
uses Claude to extract event fields from captions, then inserts
posts (and events) directly into the Alba Supabase tables.

For each handle, the script:
  1. Looks up (or auto-creates) an Alba account in `profiles` matching alba_user.
  2. Geocodes the address from the CSV to get lat/lon/geom.
  3. Scrapes the last N posts from that IG profile via Apify.
  4. Uses Claude to parse each caption into structured event fields.
  5. Creates a group for each event post (poster as sole admin).
  6. Inserts the post row into `posts`, linked to the group.
  7. Inserts a corresponding row into `events`.

Requirements:
    pip install supabase anthropic python-dotenv requests

Config (.env):
    - SUPABASE_URL / SUPABASE_KEY    : service-role key (not anon)
    - ANTHROPIC_API_KEY              : for caption parsing
    - APIFY_TOKEN                    : for Instagram scraping

CSV (scripts/handles.csv):
    handle,alba_user,address
    aperitivomilano,aperitivomilano,"Via Brera 5, Milan, Italy"
    alba.releases,alba_releases,"Corso Como 10, Milan, Italy"

    `handle`    : Instagram handle (dots allowed)
    `alba_user` : Alba username — alphanumeric, dots replaced with underscores
    `address`   : physical address used for location/lat/lon/geom
"""

import os
import csv
import uuid
import json
import time
import random
import secrets
import string
import datetime
import requests
import anthropic
from dotenv import load_dotenv
from supabase import create_client, Client

# ── Load env ──────────────────────────────────────────────────────────────────
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

# ── CONFIG ────────────────────────────────────────────────────────────────────
SUPABASE_URL         = os.getenv("EXPO_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY         = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
ANTHROPIC_API_KEY    = os.getenv("ANTHROPIC_API_KEY", "")
APIFY_TOKEN          = os.getenv("APIFY_TOKEN", "")
HANDLES_CSV          = os.path.join(os.path.dirname(__file__), "handles.csv")
ACCOUNTS_FILE        = os.path.join(os.path.dirname(__file__), "organizer_accounts.json")
PROCESSED_FILE       = os.path.join(os.path.dirname(__file__), "processed_posts.json")
MAX_POSTS_PER_HANDLE = 1
# ─────────────────────────────────────────────────────────────────────────────


def _random_password(length: int = 20) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def load_handles(csv_path: str) -> list[dict]:
    handles = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            handles.append(row)
    return handles


def _load_accounts() -> dict:
    if os.path.exists(ACCOUNTS_FILE):
        with open(ACCOUNTS_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {}


def _save_accounts(cache: dict) -> None:
    with open(ACCOUNTS_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2)


def _load_processed() -> dict:
    if os.path.exists(PROCESSED_FILE):
        with open(PROCESSED_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {}


def _save_processed(data: dict) -> None:
    with open(PROCESSED_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def geocode_address(address: str) -> tuple:
    """
    Returns (lat, lon, geom_wkt) from a plain-text address using Nominatim.
    geom_wkt is in the format expected by PostGIS geography: 'SRID=4326;POINT(lon lat)'
    Returns (None, None, None) if geocoding fails.
    """
    if not address or not address.strip():
        return None, None, None
    try:
        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": address, "format": "json", "limit": 1},
            headers={"User-Agent": "AlbaApp/1.0 (organizer-import)"},
            timeout=10,
        )
        results = resp.json()
        if results:
            lat = float(results[0]["lat"])
            lon = float(results[0]["lon"])
            geom = f"SRID=4326;POINT({lon} {lat})"
            return lat, lon, geom
    except Exception as e:
        print(f"  [!] Geocoding failed for '{address}': {e}")
    return None, None, None


def ensure_alba_account(supabase: Client, alba_username: str, handle: str) -> str:
    """
    Returns the Alba uuid for the given alba_username.
    Lookup order:
      1. profiles table (username = alba_username)
      2. local organizer_accounts.json cache (from a previous partial run)
      3. Create a new auth user + profile
    """
    # 1. Profile already fully set up
    result = supabase.table("profiles").select("id").eq("username", alba_username).execute()
    if result.data:
        print(f"  Account exists for @{alba_username} ({result.data[0]['id']})")
        return result.data[0]["id"]

    # 2. Created in a previous partial run — id is in local cache
    cache = _load_accounts()
    if alba_username in cache:
        user_id = cache[alba_username]["id"]
        print(f"  Found @{alba_username} in local cache (id: {user_id}), updating profile...")
        supabase.table("profiles").update({
            "username": alba_username,
            "name": alba_username,
            "email": cache[alba_username]["email"],
        }).eq("id", user_id).execute()
        return user_id

    # 3. Create new auth user
    email = f"{handle}@organizer.albaapp.com"
    password = _random_password()

    auth_resp = supabase.auth.admin.create_user({
        "email": email,
        "password": password,
        "email_confirm": True,
    })
    user_id = auth_resp.user.id

    # Persist credentials locally before touching the DB
    cache[alba_username] = {"id": user_id, "email": email, "password": password}
    _save_accounts(cache)
    print(f"  ✦ Created auth user for @{alba_username} (password: {password})")

    # Trigger may have auto-created the profile — update rather than insert
    supabase.table("profiles").update({
        "username": alba_username,
        "name": alba_username,
        "email": email,
    }).eq("id", user_id).execute()

    print(f"  ✦ Profile set for @{alba_username} (id: {user_id})")
    return user_id


def scrape_posts(handle: str, max_posts: int) -> list[dict]:
    """Fetches recent posts for a handle via Apify's Instagram scraper actor."""
    posts = []
    try:
        run_resp = requests.post(
            "https://api.apify.com/v2/acts/apify~instagram-scraper/runs",
            params={"token": APIFY_TOKEN},
            json={
                "directUrls": [f"https://www.instagram.com/{handle}/"],
                "resultsType": "posts",
                "resultsLimit": max_posts,
                "addParentData": False,
            },
            timeout=30,
        )
        run_resp.raise_for_status()
        run_id = run_resp.json()["data"]["id"]
        print(f"  Apify run started ({run_id}), waiting for results...")

        for _ in range(60):
            time.sleep(5)
            status_resp = requests.get(
                f"https://api.apify.com/v2/acts/apify~instagram-scraper/runs/{run_id}",
                params={"token": APIFY_TOKEN},
                timeout=15,
            )
            status = status_resp.json()["data"]["status"]
            if status == "SUCCEEDED":
                break
            if status in ("FAILED", "ABORTED", "TIMED-OUT"):
                print(f"  [!] Apify run {status}")
                return posts

        dataset_id = status_resp.json()["data"]["defaultDatasetId"]
        items_resp = requests.get(
            f"https://api.apify.com/v2/datasets/{dataset_id}/items",
            params={"token": APIFY_TOKEN, "format": "json"},
            timeout=30,
        )
        items_resp.raise_for_status()

        for item in items_resp.json()[:max_posts]:
            timestamp = item.get("timestamp") or item.get("takenAt") or ""
            try:
                post_date = datetime.datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
            except Exception:
                post_date = datetime.datetime.utcnow()

            is_video   = bool(item.get("videoUrl"))
            video_url  = item.get("videoUrl")
            image_urls = []
            if item.get("images"):
                image_urls = [img.get("url") or img for img in item["images"] if img]
            elif item.get("displayUrl"):
                image_urls = [item["displayUrl"]]

            location = item.get("location") or {}
            posts.append({
                "shortcode":  item.get("shortCode", ""),
                "caption":    item.get("caption") or "",
                "date":       post_date,
                "is_video":   is_video,
                "video_url":  video_url,
                "image_urls": image_urls,
                "thumbnail":  image_urls[0] if image_urls else None,
                "ig_location": location.get("name") if isinstance(location, dict) else None,
            })

    except Exception as e:
        import traceback
        print(f"  [!] Error scraping @{handle}: {e}")
        traceback.print_exc()
    return posts


def store_media(supabase: Client, post: dict, handle: str) -> dict:
    """
    Downloads the post's media from Instagram CDN and uploads to Supabase Storage.
    Returns updated keys: image_urls, thumbnail (Supabase public URLs).
    Falls back to original URLs on any error.
    """
    bucket   = "alba-media"
    base_key = f"posts/{handle}/{post['shortcode']}"

    # ── Video ──────────────────────────────────────────────────────────────────
    if post.get("is_video") and post.get("video_url"):
        try:
            data = requests.get(post["video_url"], timeout=60).content
            path = f"{base_key}/video.mp4"
            supabase.storage.from_(bucket).upload(
                path, data, {"content-type": "video/mp4", "upsert": "true"}
            )
            video_public = supabase.storage.from_(bucket).get_public_url(path)
            post = {**post, "image_urls": [video_public]}
            print(f"    Stored video → {path}")
        except Exception as e:
            print(f"    [!] Video upload failed: {e}")

    # ── Images ─────────────────────────────────────────────────────────────────
    stored_urls = []
    for i, url in enumerate(post.get("image_urls") or []):
        try:
            data = requests.get(url, timeout=30).content
            path = f"{base_key}/{i}.jpg"
            supabase.storage.from_(bucket).upload(
                path, data, {"content-type": "image/jpeg", "upsert": "true"}
            )
            stored_urls.append(supabase.storage.from_(bucket).get_public_url(path))
        except Exception as e:
            print(f"    [!] Image {i} upload failed: {e}")
            stored_urls.append(url)   # keep original as fallback

    # ── Thumbnail ──────────────────────────────────────────────────────────────
    thumb = post.get("thumbnail")
    if thumb and stored_urls:
        thumb = stored_urls[0]
    elif thumb:
        try:
            data = requests.get(thumb, timeout=30).content
            path = f"{base_key}/thumb.jpg"
            supabase.storage.from_(bucket).upload(
                path, data, {"content-type": "image/jpeg", "upsert": "true"}
            )
            thumb = supabase.storage.from_(bucket).get_public_url(path)
        except Exception as e:
            print(f"    [!] Thumbnail upload failed: {e}")

    return {**post, "image_urls": stored_urls or post["image_urls"], "thumbnail": thumb}


def parse_with_claude(client: anthropic.Anthropic, caption: str, ig_date: datetime.datetime) -> dict:
    """
    Asks Claude to extract structured event info from an IG caption.
    Relative date references (e.g. 'this Sunday', 'questa domenica') are
    resolved against today's date.
    """
    today = datetime.date.today()
    system = (
        "You are an assistant that extracts structured event data from Italian or English "
        "Instagram captions for a nightlife/events app called Alba. "
        f"Today's date is {today.isoformat()}. "
        "When the caption uses relative date references such as 'this Sunday', 'questa domenica', "
        "'venerdì prossimo', 'sabato', etc., resolve them to an absolute date relative to today. "
        "Return ONLY valid JSON with these keys:\n"
        "  title (str, concise event name, max 60 chars),\n"
        "  description (str, clean event description, max 300 chars),\n"
        "  date (str ISO 8601 YYYY-MM-DD or null if not found),\n"
        "  time (str HH:MM 24h or null),\n"
        "  end_time (str HH:MM 24h or null),\n"
        "  location (str venue/address or null),\n"
        "  labels (list of strings from: [Music, Party, Art, Food, Sports, Culture, Workshop, Festival, Other]),\n"
        "  is_age_restricted (bool, true if 18+ is mentioned)\n"
        "If a field cannot be found, use null. Never include extra keys."
    )
    user = (
        f"Instagram post date: {ig_date.strftime('%Y-%m-%d')}\n\n"
        f"Caption:\n{caption}\n\n"
        "Extract the event data as JSON."
    )
    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=512,
        messages=[{"role": "user", "content": user}],
        system=system,
    )
    raw = message.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        print(f"  [!] Claude returned non-JSON: {raw[:100]}")
        return {}


def create_group(supabase: Client, alba_username: str, title: str, description: str) -> str:
    """Creates a group for the event and returns its uuid."""
    group_id = str(uuid.uuid4())
    supabase.table("groups").insert({
        "id": group_id,
        "groupname": title,
        "group_desc": description,
        "members": [alba_username],
        "group_admin": [alba_username],
        "subgroups_allowed": True,
        "require_approval": False,
        "pending_members": [],
        "review_links": False,
    }).execute()
    return group_id


def build_post_row(
    alba_username: str,
    author_id: str,
    post: dict,
    parsed: dict,
    group_id: str,
    address: str,
    lat: float,
    lon: float,
    geom: str,
) -> dict:
    """Maps scraped + parsed data to the Supabase posts table schema."""
    date_str = parsed.get("date") or post["date"].strftime("%Y-%m-%d")

    return {
        "id": str(uuid.uuid4()),
        "title": parsed.get("title") or f"Event by @{alba_username}",
        "description": parsed.get("description") or post["caption"][:300],
        "user": alba_username,
        "type": "Event",
        "date": date_str,
        "time": parsed.get("time"),
        "end_time": parsed.get("end_time"),
        "location": address or parsed.get("location") or post.get("ig_location"),
        "lat": lat,
        "lon": lon,
        "geom": geom,
        "postmediauri": post["image_urls"] or None,
        "thumbnail_url": post["thumbnail"],
        "labels": parsed.get("labels") or [],
        "is_age_restricted": parsed.get("is_age_restricted") or False,
        "author_id": author_id,
        "group_id": group_id,
        "actions": ["tickets", "join_chat", "subgroups", "invite", "share", "save"],
    }


def build_event_row(post_id: str, group_id: str, alba_username: str, title: str, parsed: dict) -> dict:
    """Builds a row for the events table linked to the post."""
    date_str = parsed.get("date")
    time_str = parsed.get("time")
    if date_str and time_str:
        timestamp = f"{date_str} {time_str}:00"
    elif date_str:
        timestamp = f"{date_str} 00:00:00"
    else:
        timestamp = None

    return {
        "id": str(uuid.uuid4()),
        "title": title,
        "post_id": post_id,
        "organizers": [alba_username],
        "unconfirmed": [],
        "ticket_holders": [],
        "attendees_info": "[]",
        "purchases_active": True,
        "group_id": group_id,
        "timestamp": timestamp,
        "scanned": [],
    }


def main():
    missing = [k for k, v in {
        "SUPABASE_URL": SUPABASE_URL,
        "SUPABASE_KEY (service role)": SUPABASE_KEY,
        "ANTHROPIC_API_KEY": ANTHROPIC_API_KEY,
        "APIFY_TOKEN": APIFY_TOKEN,
    }.items() if not v]

    if missing:
        print(f"[ERROR] Missing config: {', '.join(missing)}")
        return

    if not os.path.exists(HANDLES_CSV):
        print(f"[ERROR] handles.csv not found at {HANDLES_CSV}")
        return

    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    handles = load_handles(HANDLES_CSV)
    print(f"Loaded {len(handles)} handle(s) from CSV.\n")

    total_inserted = 0
    total_skipped = 0

    for handle_row in handles:
        handle = handle_row["handle"].lstrip("@")
        alba_username = handle_row.get("alba_user") or handle.replace(".", "_")
        address = handle_row.get("address", "").strip()
        print(f"── @{handle} (alba: {alba_username}) ──────────────────────────────────────")

        # Geocode address from CSV
        lat, lon, geom = geocode_address(address)
        if lat:
            print(f"  Geocoded: {lat:.5f}, {lon:.5f}")
        else:
            print(f"  No geocode result for address: '{address}'")

        # Ensure Alba account exists
        try:
            author_id = ensure_alba_account(supabase, alba_username, handle)
        except Exception as e:
            print(f"  [!] Could not ensure account for @{alba_username}: {e}")
            continue

        posts = scrape_posts(handle, MAX_POSTS_PER_HANDLE)
        print(f"  Scraped {len(posts)} post(s)")

        processed = _load_processed()

        for post in posts:
            # Upload media to Supabase Storage before anything else
            post = store_media(supabase, post, handle)

            if processed.get(alba_username) == post["shortcode"]:
                print(f"  Already loaded latest post ({post['shortcode']}), skipping @{alba_username}")
                total_skipped += 1
                continue

            if not post["caption"].strip():
                print(f"  Skipping {post['shortcode']} (no caption)")
                total_skipped += 1
                continue

            parsed = parse_with_claude(claude, post["caption"], post["date"])
            if not parsed:
                total_skipped += 1
                continue

            title = parsed.get("title") or f"Event by @{alba_username}"

            try:
                group_id = create_group(supabase, alba_username, title, parsed.get("description") or post["caption"][:300])
            except Exception as e:
                print(f"  [!] Group creation failed for {post['shortcode']}: {e}")
                total_skipped += 1
                continue

            post_row = build_post_row(alba_username, author_id, post, parsed, group_id, address, lat, lon, geom)

            try:
                supabase.table("posts").insert(post_row).execute()
                print(f"  ✓ Post inserted: {post_row['title']} ({post_row['date']})")
                processed[alba_username] = post["shortcode"]
                _save_processed(processed)
                total_inserted += 1
            except Exception as e:
                print(f"  ✗ Post insert failed for {post['shortcode']}: {e}")
                total_skipped += 1
                continue

            event_row = build_event_row(post_row["id"], group_id, alba_username, title, parsed)
            try:
                supabase.table("events").insert(event_row).execute()
                print(f"  ✓ Event inserted: {event_row['timestamp']}")
            except Exception as e:
                print(f"  ✗ Event insert failed: {e}")

            time.sleep(random.uniform(2, 5))

        if handle_row != handles[-1]:
            delay = random.uniform(20, 45)
            print(f"  Waiting {delay:.0f}s before next handle...")
            time.sleep(delay)

    print(f"\nDone. {total_inserted} inserted, {total_skipped} skipped.")


if __name__ == "__main__":
    main()
