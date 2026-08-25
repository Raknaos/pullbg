# CutBG — progression

Vague **4** **30/50** · score **90,0** / **83** cas · IoU 0,803 · group **87,3** · hair **92,6** · stamp **85,0**

Pires : prod-07 74,5 · plant-01 77,9 · prod-03 78,0 · prod-01 78,1 · prod-02 79,3

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
| w4-19 | fait | GT group-01 = sujet cadre droit, keep |
| w4-20 | fait | GT hair-11 leftover bas périmé, refresh |
| w4-21 | fait | GT hair-09 = sujet cadre bas, keep |
| w4-22 | fait | revoir GT fur-02 |
| w4-23 | fait | revoir GT hair-10 |
| w4-24 | fait | revoir GT win-03 |
| w4-25 | in_progress | GT 30 cas |
| w4-26 | restant | GT 40 cas |
| w4-27 | restant | classif group |
| w4-28 | restant | classif fur vs hair |
| w4-29 | restant | test classif canvas local |
| w4-30 | restant | lastGuess group live |
| w4-31 | fait | stick 7 vs 5 −0,08, keep 5 |
| w4-32 | restant | fuse 0,35/0,65 |
| w4-33 | restant | crop pad 0,14 |
| w4-34 | restant | two-pass coarse 720 |
| w4-35 | fait | guided r5 si rough 30–80, keep si score tient |
| w4-36 | fait | grow hair +1 −0,15, keep 2 |
| w4-37 | fait | erode leftover 1 px cadre |
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
| close3 | close intérieur 3 px Max7, 28 keep / 55 revert, glass-02 intact | 89,9→**90,0** · food 85,9→86,1 · group 87,1→87,3 · object 90,8→91,0 · plant 91,6→91,8 |
| med5 | MedianFilter 5, 60 keep / 23 revert, glass-02 intact | 89,6→**89,9** · fur 88,0→88,5 · glass 93,0→93,3 · group 86,8→87,1 · plant 91,2→91,6 |
| jaggy15 | guided r5 rough 15–20, 29 coupes, 23 revert, glass-02 intact | **89,6** · glass 92,8→93,0 · product 86,6→86,8 · fur 87,9→88,0 |
| w4-24 | GT win-03 : sujet cadre (bot 16 %, frame 8 %), keep | leftover 0 IoU 0,957 |
| jaggy20 | guided r5 rough 20–25, 26 coupes, 19 revert, glass-02 intact | 89,5→**89,6** · glass 92,6→92,8 · product 86,3→86,6 · object 90,3→90,7 |
