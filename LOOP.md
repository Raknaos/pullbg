# PullBG — boucle autonome

Le cron « PullBG loop » tourne tout seul. L’utilisateur dit **stop** pour couper.

## Brief produit (ne jamais casser)

- Studio = drop multi-images, file auto, **zéro option**
- Accueil : pas d’exemples, pas de prix
- 10 images/jour **sans compte** (jamais « gratuit »)
- 11ᵉ = aperçu flou + créer un compte
- Après compte → `pricing.html` : 2,99 €/mois, 19,99 €/an (29,99 barré)
- Compteur reset minuit local
- Moteur autonome (classifieur + géométrie puis affinage si besoin)
- Timbres = pièce entière ; fenêtres = percer l’intérieur
- Repo : `C:\Users\bapti\Downloads\pelure` → `github.com/Raknaos/pullbg` → Pages

## Une tick = une amélioration réelle

1. Lire ROADMAP.md + git log -5 + ce fichier
2. Choisir UN gain (moteur d’abord, puis file/UX/tests)
3. Coder, `node --check`, commit, `git push origin main`
4. Noter dans ce fichier (3 lignes max) ce qui a été fait
5. Si rien d’utile : lancer `eval/check_known.py` (rembg-env) ou durcir un test — ne pas inventer du fluff UI

## Interdit

- Demander confirmation
- Remettre des options / galerie / prix sur l’accueil
- Dire « 10 images gratuites »
- Reboot / toucher d’autres projets

## Journal
- 2026-08-19: EXIF `from-image` + plafond 2200px. Affinage IA sur l’image déjà redressée (plus de mix tordu). FastCut 3 en parallèle.
