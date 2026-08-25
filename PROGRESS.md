# CutBG — progression

Vague **4** **16/50** · score **80,9** / 81 cas · IoU 0,924 · group **81,9** · hair **82,7**

Pires : fur-02 68,1 · hair-09 69,5 · glass-02 72,6 · plant-01 73,4 · plant-06 73,7

## Vague 4 — tâches

| id | statut | tâche |
|---|---|---|
| w4-01 | fait | leftover cheveux connecté |
| w4-02 | fait | leftover fourrure drop saut |
| w4-03 | fait | studio-05 70,1→82,1 |
| w4-04 | fait | stamp-03 63,9→76,3 |
| w4-05 | fait | group-01 74,1→79,5 |
| w4-06 | fait | plant-01 leftover = pot au cadre, skip |
| w4-07 | fait | prod-07 holes = vide casque, skip fill |
| w4-08 | restant | frange food intérieure |
| w4-09 | fait | glass-02 IoU ~1,0 — ne pas toucher |
| w4-10 | fait | drop_fringe_bg 3,5→3,0 % |
| w4-11 | fait | laptop-01 déjà au banc |
| w4-12 | fait | laptop-02 déjà au banc |
| w4-13 | fait | backlit-01 déjà au banc |
| w4-14 | fait | white-shirt-01 déjà au banc |
| w4-15 | restant | +2 cas group |
| w4-16 | fait | fur-02 leftover = poitrail, skip drop |
| w4-17 | restant | +1 cas stamp dentelé |
| w4-18 | fait | drop_floating sur banc (îlots hair-09) score 80,2→80,9 |
| w4-19 | restant | revoir GT group-01 |
| w4-20 | restant | revoir GT hair-11 |
| w4-21 | restant | revoir GT hair-09 |
| w4-22 | restant | revoir GT fur-02 |
| w4-23 | restant | revoir GT hair-10 |
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
| w4-40 | restant | largestForeground multi |
| w4-41 | restant | sync decontaminate |
| w4-42 | restant | recut rembg local |
| w4-43 | restant | ci score gate |
| w4-44 | restant | snapshot score-wave4 |
| w4-45 | en cours | déployer aiworker |
| w4-46 | restant | accueil sans prix/exemples |
| w4-47 | restant | pas Grok via Go |
| w4-48 | restant | pas Phase 3 GPU |
| w4-49 | restant | banc ≥ 82 |
| w4-50 | restant | close vague 4 si ≥ 85 |

## 5 faites récentes

| id | action | score |
|---|---|---|
| w4-18 | drop_floating îlots + dropBgLeftover papier timbre | 80,2→**80,9** stamp-03 83,9 |
| w4-05 w4-10 | drop_fringe_bg 3,5→3,0 | group-01 74,1→79,5 |
| w4-16 | fur-02 poitrail au cadre, skip | 68,1 |
| w4-06 | plant-01 pot au cadre, skip | 80,2 |
| w4-07 | prod-07 vide casque, skip fill | 80,2 |
