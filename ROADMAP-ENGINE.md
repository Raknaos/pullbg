# CutBG — roadmap vivante

Objectif moteur : ANALYSE → ORDRES → COUPE → VÉRIF, CPU 8 Go, score mesuré.
Cible honnête : ≥ 98 sur le banc. Puis site niveau remove.bg, puis suite (gomme, fonds).

Contraintes : VPS 8 Go · 5,50 €/mois · DeepSeek Vision (Go) · Grok = SuperGrok uniquement.

## Boucle
50 tâches → mesurer → roadmap → 50 nouvelles. Jamais idle.

## Où on en est (2026-08-25, soir)

| Phase | Statut | Détail |
|---|---|---|
| **0 Banc** | **v0.4** | **75 cas**, score **78,1**. IoU 20 GT, mean **0,986**. group **72,8**. hair **79,1**. window **84,6**. |
| **1 Ordres** | **OK** | DeepSeek + fenetre/timbre/chroma/ciel. lastGuess live. |
| **2 Moteur** | **int8 + 2 passes + fuse + stick + fringe + float leftover** | Vague 3 **2/50**. |
| **3 Distillation** | **bloquée** | score < 90 |
| **4 Continu** | vague 3 | w3-03 drop_uniform dist 50→28 |
| **5 Site / remove.bg** | après moteur ~pro | |

Vague 3 live. https://cutbg.studio · 100/jour · Messenger · Stripe hors accueil.

## Règle
On ne garde un changement moteur que si `eval/score.json` monte.
