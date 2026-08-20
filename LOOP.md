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
- 2026-08-19: Fenêtres — punch intérieur sans flood noir (cadre conservé). Timbres — flood papier clair, trous puis pièce entière, bande 5%. Test `eval/test_engine.mjs`.
- 2026-08-19: Quota rendu si découpe plante. ZIP sans collision de noms. Mix IA/geo même si tailles différentes. Cache bust v=5.
- 2026-08-19: Qualité : plus de fillInteriorHoles (ça bouchait les yeux). Objets/produits → IA obligatoire comme v1. Geo seulement timbres/fenêtres/fond noir.
- 2026-08-19: Fenêtres 4 carreaux : somme des intérieurs (plus le 1er volet trop petit). Punch dès 1,2 %. Timbres : flood couleur papier crème, revert si ça mange la pièce.
- 2026-08-19: Fenêtres JPEG/gris : seuil vitre = cadre−6 borné 14–22 (plus seulement lum≤14). Test vitre 20. Cache-bust modules v=7.
- 2026-08-19: Pages JPEG blanches : seuil = max(234, cadre+40) borné 248 (plus seulement lum≥248). Patch 210 non classé page. Cache-bust v=8.
- 2026-08-19: Studio 3 colonnes (file / toile / actions). Accueil titre seul, zéro exemples/prix. Cache v=9.
- 2026-08-20: Suppression du curseur avant/après. Logos sur fond noir restent en géométrie; les timbres multi-pièces ne restaurent plus le papier entre deux pièces.
- 2026-08-19: Timbres avant fenêtres (centre gravé plus classé écran). Trous dentelés soft + halo sombre. ImageData lâchée après découpe. Cache v=10.
- 2026-08-19: Planche de timbres : on garde toutes les pièces ≥10 % de la plus grande (plus seulement le plus gros blob). Cache v=11.
- 2026-08-19: Timbre scanné : marge papier gardée dans le rectangle dentelé (pièce entière). Planche crème + trous ≠ fond noir. Cache v=12.
- 2026-08-19: Timbre au milieu d’un album : dentelé sur la pièce, plus seulement les bords de l’image. Pièce entière + album enlevé. Cache v=13.
- 2026-08-20: Planche album : dentelé + marge sur chaque timbre, sans remplir le papier entre les pièces. Cache v=16.
- 2026-08-20: Fenêtres 16 carreaux : petits intérieurs rectangulaires comptés et percés (plus seulement ≥1,2 %). Cache v=17.
- 2026-08-20: Fenêtres jour / crépuscule : vitres ciel multi-carreaux et verre gris (cadre 52 / vitre 30) percés. Seuil plus le cap 22. Cache v=18.
- 2026-08-20: Timbres sur album bleu/gris : flood de la couleur du papier (plus seulement crème/blanc). Fond sombre = médiane des bords, pas la moyenne tirée par les trous. Cache v=19.
- 2026-08-20: IA-first restauré pour objets généraux. Multi-pane exige désormais des composants rectangulaires : deux pupilles rondes ne sont plus percées. Cache v=20.
- 2026-08-20: Fenêtres : flood 4-connect, les carreaux qui se touchent en coin restent séparés. IA 100 % opaque rejetée : le secours transparent gagne toujours. Cache v=21.
- 2026-08-20: File : ImageBitmap.close() après lecture des pixels (plus de fuite native sur les lots). Cache v=22.
- 2026-08-20: Fenêtres mixtes jour/nuit : vitres sombres ET ciel percées ensemble (plus seulement le type majoritaire). Cache v=23.
- 2026-08-20: Graphismes plats sur fond blanc : couleur dominante isolée par chroma. Blanc/gris intérieur et blobs IA supprimés ; photos et produits multicolores restent sur IA. Cache v=24.
- 2026-08-20: Fenêtres bois / feuillage : carreaux d’une autre couleur que le cadre percés (plus seulement un écart de luminance). Produits ronds sur fond noir inchangés. Cache v=25.


