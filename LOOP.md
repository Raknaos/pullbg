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
- 2026-08-20: Fenêtres PVC blanches : carreaux sombres percés même si le cadre est blanc (plus bloqué par whiteFrac). Un seul objet noir sur blanc reste en IA. Cache v=26.
- 2026-08-20: Fenêtres PVC blanches + vitres ciel : carreaux similaires dont le croisillon est de la couleur du cadre percés (plus bloqué par whiteFrac). Produits multicolores et graphismes plats inchangés. Cache v=27.
- 2026-08-20: Deux produits sur fond blanc : plus classés fenêtre. Grille 4 carreaux ou 2 vitres ciel sur PVC blanc inchangées. Cache v=28.
- 2026-08-20: Battant PVC blanc 2 carreaux (nuit, ou nuit+ciel) : cadre serré + croisillon = fenêtre. Deux produits avec marge restent en IA. Cache v=29.
- 2026-08-20: VPS prêt : deploy/ (contabo 8 Go, 1 mois sans engagement). API Express + file JSON single-worker + worker node réutilisant lib/classify+cutout + aiworker.py (rembg isnet-local). Testé local : logo <3> route couleur (78,4 % transparent), anneaux via IA (75,4 %). Installateur install.sh + systemd + nginx + certbot.
- 2026-08-20: Fenêtres PVC blanches, vitres ciel cramées : carreaux quasi blancs percés (tint 16, plus bloqué à 32). Deux produits gris pâles restent en IA. Cache v=30.
- 2026-08-20: Timbres rouleau / carnet : 2 bords dentelés suffisent (plus 40 trous). Pointillés de studio ignorés. Cache v=31.
- 2026-08-20: Fond studio uni (vert/bleu/gris) : flood de la couleur du bord. Écran bleu plus classé noir. Produit blanc sur fond rouge plus une page. Cache v=32.
- 2026-08-20: Cyclorama dégradé : flood depuis les coins (plus une moyenne de bord). Produit posé au sol ou sur un coin conservé. Cache v=33.
- 2026-08-20: Une seule vitre ciel / feuillage / arc : percée (plus classée produit). Logo bleu et bouteille cyan inchangés. Cache v=34.
- 2026-08-20: Œil-de-bœuf : vitre ronde ciel/feuillage percée (cadre bois gardé). Assiette bleue sur blanc et balle sur noir inchangées. Cache v=35.
- 2026-08-20: Œil-de-bœuf oval + lancette gothique : vitres allongées ciel/feuillage percées. Assiette ovale sur blanc et produit oval sur noir inchangés. Cache v=36.
- 2026-08-20: Imposte demi-lune : vitre ciel/feuillage percée (plus classée fond studio). Produit semi-circulaire sur noir inchangé. Cache v=37.
- 2026-08-20: Vitre nuit dans un cadre bois : percée (rect / rond / ovale / imposte). Produit sombre sur gris/blanc/noir inchangé. Cache v=38.
- 2026-08-21: Vitre chaud / coucher de soleil dans un cadre bois : percée (rect / rond / ovale / imposte). Produit orange sur gris/blanc/noir inchangé. Cache v=39.
- 2026-08-21: Vitre overcast / gris froid dans un cadre bois ou PVC blanc : percée (rect / rond / ovale / imposte). Produit gris sur blanc/noir/studio inchangé. Cache v=40.
- 2026-08-21: Vitre losange / plomb dans un cadre bois : percée (ciel / feuillage). Produit losange sur blanc/noir inchangé. Cache v=41.
- 2026-08-22: Vitre triangulaire / pignon dans un cadre bois : percée (ciel / feuillage). Produit triangle sur blanc/noir inchangé. Cache v=42.
- 2026-08-22: Vitre quadrilobe / quatre-feuilles dans un cadre bois : percée (ciel / feuillage). Produit trèfle sur blanc/noir inchangé. Cache v=43.
- 2026-08-22: Vitre trapèze / lucarne dans un cadre bois : percée (ciel / feuillage). Produit trapèze sur blanc/noir inchangé. Cache v=44.
- 2026-08-22: Vitre étoile / pentagramme dans un cadre bois : percée (ciel / feuillage). Produit étoile sur blanc/noir inchangé. Cache v=45.
- 2026-08-22: Grille plombée 4 losanges dans un cadre bois : percée (ciel / feuillage), croisillon gardé. Deux produits losange sur blanc/noir inchangés. Cache v=46.
- 2026-08-22: Œil-de-bœuf à bossage : anneau percé, médaillon central gardé (plus traité comme poussière). Produit concentrique sur noir inchangé. Cache v=47.
- 2026-08-22: Timbre rond : dentelé circulaire reconnu, pièce entière + trous percés (plus classé fond). Produit rond sur blanc/noir inchangé. Cache v=48.
- 2026-08-22: Timbre ovale : dentelé elliptique reconnu, pièce entière + trous percés (plus classé fond). Produit ovale sur blanc/noir inchangé. Cache v=49.
- 2026-08-22: Timbre losange : dentelé en losange reconnu, pièce entière + trous percés (plus classé fond). Produit losange sur blanc/noir inchangé. Cache v=50.
- 2026-08-22: Timbre hexagonal : dentelé 6 côtés reconnu, pièce entière + trous percés (plus classé fond). Produit hexagonal sur blanc/noir inchangé. Cache v=51.
- 2026-08-22: Timbre octogonal : dentelé 8 côtés reconnu, pièce entière + trous percés (plus classé fond). Produit octogonal sur blanc/noir inchangé. Cache v=52.
- 2026-08-22: Timbre pentagonal : dentelé 5 côtés reconnu, pièce entière + trous percés (plus classé fond). Produit pentagonal sur blanc/noir inchangé. Cache v=53.
- 2026-08-22: Timbre triangulaire : dentelé 3 côtés reconnu, pièce entière + trous percés (plus classé fond). Produit triangulaire sur blanc/noir inchangé. Cache v=54.
- 2026-08-22: Timbre étoile : dentelé 10 côtés reconnu, pièce entière + trous percés (plus classé fond). Produit étoile sur blanc/noir inchangé. Cache v=55.
- 2026-08-22: Timbre cœur : dentelé reconnu, pièce entière + trous percés (plus classé fond). Produit cœur sur blanc/noir inchangé. Cache v=56.
- 2026-08-22: File : le mur quota ne consomme plus de slots sans découper, et n’abandonne plus l’affinage des images déjà prêtes. Pixels lâchés si découpe/affinage plante. Cache v=57.
- 2026-08-22: Timbre croissant : dentelé reconnu, pièce entière + trous percés (plus classé fond). Produit croissant sur blanc/noir inchangé. Cache v=58.
- 2026-08-22: Timbre goutte : dentelé reconnu, pièce entière + trous percés (plus classé fond). Produit goutte sur blanc/noir inchangé. Cache v=59.
- 2026-08-22: Timbre écu : dentelé reconnu, pièce entière + trous percés (plus classé fond). Produit écu sur blanc/noir inchangé. Cache v=60.
- 2026-08-22: Timbre croix : dentelé reconnu, pièce entière + trous percés (plus classé fond). Produit croix sur blanc/noir inchangé. Cache v=61.
- 2026-08-22: Timbre flèche : dentelé reconnu, pièce entière + trous percés (plus classé fond). Produit flèche sur blanc/noir inchangé. Cache v=62.
- 2026-08-22: Timbre nuage : dentelé reconnu, pièce entière + trous percés (plus classé fond). Produit nuage sur blanc/noir inchangé. Cache v=63.
- 2026-08-22: Timbre trèfle : dentelé reconnu, pièce entière + trous percés (plus classé fond). Produit trèfle sur blanc/noir inchangé. Cache v=64.
- 2026-08-22: Timbre fleur : dentelé 5 pétales reconnu, pièce entière + trous percés. Motif <8 % plus avalé si le dentelé tient. Produit fleur sur blanc/noir inchangé. Cache v=65.
- 2026-08-23: Timbre papillon : dentelé 4 lobes reconnu, pièce entière + trous percés (plus classé fond). Produit papillon sur blanc/noir inchangé. Cache v=66.
- 2026-08-23: Timbre feuille : dentelé 5 lobes + tige reconnu, pièce entière + trous percés (plus classé fond). Produit feuille sur blanc/noir inchangé. Cache v=67.
- 2026-08-23: Timbre poisson : dentelé tête + nageoires + queue fourchue reconnu, pièce entière + trous percés (plus classé fond). Produit poisson sur blanc/noir inchangé. Cache v=68.



