# PullBG — roadmap de construction

Règle : une couche livrée et vérifiée avant la suivante. Pas de « plus tard on remplacera ».
Si plus aucune tâche : en chercher d’autres (moteur, file, UX, tests) — jamais idle.
Interdit : dire « 10 images gratuites ». Interdit : « l’IA seule rate / seul un modèle peut ».

## Phase 0 — Socle (fait)
- Studio local, file, Auto, cas timbre / fenêtre / fond
- Funnel : 10/jour sans compte → flou → compte → offres
- Prix : 2,99 € / mois, 19,99 € / an (29,99 barré)
- Moteur multi-passes + score + anti-mangeage
- Landing vente (preuve réelle, FAQ, prix)

## Phase 1 — Site produit public (en cours)
- Favicon, OG, titre, description, sitemap, 404
- Mentions / confidentialité (images locales)
- Pages propres, mobile, accessibilité
- Déploiement GitHub Pages (0 €)
- Domaine pullbg.com (OVH) quand tu l’achètes

## Phase 2 — Studio « outil » (ensuite)
- Comparateur plus net, zoom, historique session
- Raccourcis clavier, états vides soignés
- Export ZIP nommé, fond damier / magenta QA
- Compteur reset visible et stable

## Phase 3 — Moteur (jamais fini)
- Durcir classifieur (moins de faux timbres / faux fonds)
- Trous dentelé plus précis, moins de franges
- Ensemble IA + géométrie sur plus de cas
- Banc 1000 DUTS + tes 13 images à chaque changement
- Remplacer le bloc AGPL (imgly) avant vrai business

## Phase 4 — Comptes & argent
- Clerk ou Supabase Auth (vrais emails)
- Stripe : 2,99 / 19,99
- Quota serveur (sinon localStorage se reset)
- Webhook + page succès / échec

## Phase 5 — Croissance
- SEO FR/EN, page /en
- Exemples indexables
- Analytics privacy-first (sans tracker lourd)
- Support mail

## Phase 6 — Scale seulement si ça marche
- VPS 8 Go ou API Photoroom sur le cas « produit »
- Jamais de GPU tant que < 20k images / mois
