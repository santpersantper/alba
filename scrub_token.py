import os
f = "eas.json"
if os.path.exists(f):
    c = open(f, encoding="utf-8").read()
    c = c.replace(os.environ.get("MAPBOX_TOKEN_TO_SCRUB", ""), "")
    open(f, "w", encoding="utf-8").write(c)
