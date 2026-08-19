# PullBG

pullbg.com — détourage dans le navigateur.

## Parcours

1. Studio utilisable **sans compte** (10 images / jour).
2. Au-delà : aperçu **flou + bloqué**, création de compte obligatoire.
3. Après inscription → page **Offres** (2,99 € / mois, **19,99 €** / an barré 29,99 €).
4. Compte : encore 10 / jour + **compteur** jusqu’au prochain lot (minuit local).
5. PullBG+ : illimité.

Ne jamais écrire « 10 images gratuites ».

## Lancer

```bash
cd C:\Users\bapti\Downloads\pelure
python -m http.server 8770
```

http://127.0.0.1:8770

## Moteur

`lib/engine.js` : classifieur → plusieurs passes (timbre v4, floods, IA) → score → anti-mangeage IA+géo → perçage intérieur → décontamination.

## Prod plus tard

Cloudflare Pages + domaine pullbg.com + Stripe 2,99 / 19,99.
