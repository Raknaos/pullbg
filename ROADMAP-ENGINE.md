# CutBG — roadmap vivante

Objectif moteur : ANALYSE → ORDRES → COUPE → VÉRIF, CPU 8 Go, score mesuré.
Cible honnête : ≥ 98 sur le banc. Puis site niveau remove.bg, puis suite (gomme, fonds).

Contraintes : VPS 8 Go · 5,50 €/mois · DeepSeek Vision (Go) · Grok = SuperGrok uniquement.

## Boucle de travail (ordre de Baptiste)

1. Vague de **50 tâches** concrètes.
2. Les finir sans pause. Mesurer. Revert si le score baisse.
3. Mettre à jour **cette** roadmap.
4. Inventer **50 nouvelles** tâches (moteur d’abord, ensuite site, ensuite suite produit).
5. Recommencer. Jamais idle.

## Où on en est (2026-08-25)

| Phase | Statut | Détail |
|---|---|---|
| **0 Banc** | **v0.3** | **68 cas**, score **71,7**. 61 cas **71,6**. Fenêtres **74,7**. `ci.sh` + `worst.json`. |
| **1 Ordres** | **OK** | DeepSeek + `pipeline` honoré (fenetre/timbre/chroma). |
| **2 Moteur** | **int8 + 2 passes + fuse + stick adaptatif** | Frange ≥6 % : hard 160 / r=7. fur-03 **60,8**. hair-02 rose collé (**46,8**). |
| **3 Distillation** | **bloquée** | tant que score < 90 |
| **4 Continu** | amorcé | cette boucle 50/50 |
| **5 Site / remove.bg** | **après moteur ~pro** | exemples avant/après, gomme d’objet, fonds, tout le catalogue remove.bg |

Vague 1 (50) : quasi close. Score 61 cas 69,1 (cible 70 pas encore). Fenêtres office mal classées (ia/timbre au lieu de punch).

## Produit déjà live

https://cutbg.studio · 100 images/jour · Messenger · Stripe 2,99 / 19,99 · wipe démo blanc `?v=67`

## Ensuite (vague 2+)

- Classifieur fenêtre / timbre (les 3 `win-*` sont faux)
- Hair-02 encore 46,8 (fond rose). hair 66 / fur 66,9 → 68
- Score 68 cas ≥ 80
- Masques main sur les 20 pires
- Site : galerie avant/après, pages features remove.bg
- Suite : gomme, remplacer fond, batch API

## Règle score

On ne garde un changement moteur que s’il monte `eval/score.json`. Sinon revert.
