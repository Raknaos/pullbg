# CutBG — progression

Vague **4** **20/50** · score **83,1** / **84** cas · IoU 0,803 · group **84,8** · hair **84,7** · stamp **84,0**

Pires : fur-02 71,7 · hair-09 72,0 · plant-01 74,3 · prod-07 74,4 · prod-02 75,0

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
| w4-08 | fait | frange food intérieure (guided r6 intérieur) |
| w4-09 | fait | glass-02 IoU ~1,0 — ne pas toucher |
| w4-10 | fait | drop_fringe_bg 3,5→3,0 % |
| w4-11 | fait | laptop-01 déjà au banc |
| w4-12 | fait | laptop-02 déjà au banc |
| w4-13 | fait | backlit-01 déjà au banc |
| w4-14 | fait | white-shirt-01 déjà au banc |
| w4-15 | fait | +2 cas group-03 69,8 / group-04 80,3 |
| w4-16 | fait | fur-02 leftover = poitrail, skip drop |
| w4-17 | fait | +1 cas stamp dentelé |
| w4-18 | fait | drop_floating banc 80,2→80,9 |
| w4-19 | in_progress | revoir GT group-01 |
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
| w4-44 | fait | snapshot score-wave4.json |
| w4-45 | fait | déployer aiworker VPS (fringe 3 % live) |
| w4-46 | restant | accueil sans prix/exemples |
| w4-47 | restant | pas Grok via Go |
| w4-48 | restant | pas Phase 3 GPU |
| w4-49 | restant | banc ≥ 82 |
| w4-50 | restant | close vague 4 si ≥ 85 |

## 5 faites récentes

| id | action | score |
|---|---|---|
| w4-17 | stamp-04 UNR 1918 dentelé, classif timbre, coupe géo 84,6 | 84 cas · stamp 83,9→84,0 · global **83,1** |
| w4-08 | smooth_interior_fringe r6/8e-3 | 80,8→81,9 · food 80,9→81,5 · food-03 79,9→81,7 |
| w4-15 | group-03/04 via API live | 83 cas, group-03 **69,8** |
| w4-45 | aiworker VPS restart | health OK build 3 |
| w4-18 | drop_floating 60 coupes | 80,2→80,9 (81 cas) |
