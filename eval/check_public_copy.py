from pathlib import Path
root = Path(r"C:/Users/bapti/Downloads/pelure")
needles = ("2,99", "19,99", "gratuit", "stamp.png", "word.png", "Voir les offres", "#prix")
public = list(root.glob("*.html"))
for p in public:
    t = p.read_text(encoding="utf-8")
    hits = [n for n in needles if n.lower() in t.lower()]
    # pricing page is allowed to have prices
    if p.name == "pricing.html":
        hits = [n for n in hits if n not in ("2,99", "19,99")]
    print(f"{p.name:16} {hits}")
print("index euros", "€" in (root/"index.html").read_text(encoding="utf-8"))
print("app euros", "€" in (root/"app.html").read_text(encoding="utf-8"))
print("en euros", "€" in (root/"en.html").read_text(encoding="utf-8"))
