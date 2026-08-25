# CutBG — progression

Vague **4** **3/50** · score **79,8** / 81 cas · IoU 0,928 (20 GT)

Pires : stamp-03 63,9 · fur-02 68,1 · studio-05 70,1 · hair-09 70,3 · glass-02 72,6

## Vague 4 — tâches

| id | statut | tâche |
|---|---|---|
| w4-01 | fait | leftover cheveux connecté (coin ≠ sujet, dist 52/18) |
| w4-02 | fait | leftover fourrure (fur-02 = sujet au cadre, drop saut) |
| w4-03 | fait | leftover studio-05 = pantalon au cadre, pas gris — skip drop |
| w4-04 | en cours | stamp-03 classif Penny Black OK ; stampCut mange encore la gravure |
| w4-05 | restant | groupes multi-sujets (group-01 73,3) |
| w4-06 | restant | leftover plant (plant-01 / 06 73,0) |
| w4-07 | restant | trous produit (prod-07 74,4) |
| w4-08 | restant | frange food intérieure |
| w4-09 | restant | glass-02 rough 72,6 |
| w4-10 | restant | fringe cadre 3,0 % (group-01) |
| w4-11 | restant | couper laptop-01 |
| w4-12 | restant | couper laptop-02 |
| w4-13 | restant | couper backlit-01 |
| w4-14 | restant | couper white-shirt-01 |
| w4-15 | restant | +2 cas group |
| w4-16 | restant | +2 cas fur |
| w4-17 | restant | +1 cas stamp dentelé |
| w4-18 | restant | +2 cas hair hard |
| w4-19 | restant | revoir GT group-01 |
| w4-20 | restant | revoir GT hair-11 |
| w4-21 | restant | revoir GT hair-09 |
| w4-22 | restant | revoir GT fur-02 |
| w4-23 | restant | revoir GT hair-10 (leftover ciel dans GT) |
| w4-24 | restant | revoir GT win-03 |
| w4-25 | restant | GT 30 cas |
| w4-26 | restant | GT 40 cas |
| w4-27 | restant | classif group |
| w4-28 | restant | classif fur vs hair |
| w4-29 | restant | test classif canvas local |
| w4-30 | restant | lastGuess group live |
| w4-31 | restant | stick 7 vs 5 retest |
| w4-32 | restant | fuse 0,35/0,65 |
| w4-33 | restant | crop pad 0,14 |
| w4-34 | restant | two-pass coarse 720 |
| w4-35 | restant | guided radius |
| w4-36 | restant | grow hair |
| w4-37 | restant | erode leftover |
| w4-38 | restant | protectSubject live |
| w4-39 | restant | fillInteriorHoles live |
| w4-40 | restant | largestForeground multi (group) |
| w4-41 | restant | sync decontaminate cutout.js |
| w4-42 | restant | recut rembg local si dispo |
| w4-43 | restant | ci score gate |
| w4-44 | restant | snapshot score-wave4 |
| w4-45 | restant | déployer aiworker |
| w4-46 | restant | accueil sans prix/exemples |
| w4-47 | restant | pas Grok via Go |
| w4-48 | restant | pas Phase 3 GPU |
| w4-49 | restant | banc ≥ 82 |
| w4-50 | restant | close vague 4 si ≥ 85 |

## 5 faites récentes

| id | action | score |
|---|---|---|
| w4-04 | classif Penny Black sans dentelé (tests OK) | 79,8 inchangé — stampCut fuit |
| w4-03 | studio-05 leftover = pantalon, skip drop | 79,8 |
| w4-02 | leftover saut couleur (jump≥16) | 79,5→79,8 |
| w4-01 | leftover coin ≠ sujet 52/18 | 79,0→79,5 |
| w3-03 | drop_uniform dist 50→28 | 78,3→78,7 |
