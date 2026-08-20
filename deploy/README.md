# PullBG — Production VPS (Contabo Cloud VPS 4 · 8 Go · 5,50 €/mois sans engagement)

Ce dossier déploie **PullBG sur un VPS** : le même moteur validé du site
(`lib/classify.js` + `lib/cutout.js`, aucun réécrit) avec une file d'attente
et un micro-service IA local (rembg). Un seul worker : idéal pour 0-2
utilisateurs simultanés.

## 1. Commander le VPS (fait par l'utilisateur)

- Page de config officielle : **https://contabo.com/en/vps/cloud-vps-core-4**
- Options validées sur la page :
  - **Term : 1 Month → 5,50 €/mois, sans frais, sans engagement** ✅
  - Region : European Union (gratuite)
  - Storage : 100 Go SSD (gratuit)
  - Image : Ubuntu (gratuit)
  - Auto Backup : recommandé à 1,65 €/mois (optionnel, activable plus tard)
  - Password root : générer un mot de passe fort, le garder précieusement
- Après paiement : noter l'**IP du serveur** et le **mot de passe root**.

## 2. Première connexion

```bash
ssh root@IP_DU_SERVEUR
```

## 3. Installation (une commande)

Depuis le serveur :

```bash
apt-get update && apt-get install -y git
git clone https://github.com/Raknaos/pullbg.git /opt/src
cd /opt/src/deploy
bash install.sh
```

L'installateur :
- installe Node 20 + Python 3 + nginx + firewall
- crée l'utilisateur `pullbg`
- met en place le venv Python + rembg (modèle `isnet-general-use`, ~170 Mo)
- installe les dépendances Node du serveur
- démarre `pullbg-ai` (rembg) et `pullbg-api` (file + worker) en systemd
- configure nginx en reverse proxy sur le port 80

Vérification :

```bash
curl http://127.0.0.1:8080/api/health
# {"ok":true,...}
```

## 4. HTTPS + domaine

Avant HTTPS, il faut un nom de domaine :

1. Acheter le domaine (ex. `pullbg.com` — enregistrement possible chez OVH,
   Cloudflare ou autre, ~5-10 €/an).
2. Ajouter un enregistrement **A** : `pullbg.com` → IP du VPS.
3. Installer Let's Encrypt :

```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d pullbg.com -d www.pullbg.com
```

## 5. API

| Route | Description |
|---|---|
| `POST /api/cut` | multipart `image` → `{ id }` (limite 10/jour par client) |
| `GET /api/jobs/:id` | `{ status, pipeline, guess, result? }` |
| `GET /api/result/:id.png` | PNG final avec fond transparent |
| `GET /api/health` | santé du service |

La file est **JSON sur disque** (pas de Redis) : un seul worker FIFO, les
résultats sont purgés au bout de 24 h, quota 10 images/jour par client.
L'IA (rembg) tourne en local, jamais d'envoi vers un cloud tiers.

## 6. Mise à jour

```bash
cd /opt/src && git pull
bash deploy/install.sh   # recopie lib + redémarre les services
```

## Coût mensuel

| Poste | Prix |
|---|---:|
| Contabo Cloud VPS 4 (1 mois, sans engagement) | 5,50 € |
| Domaine | ~0,50 €/mois (5-10 €/an) |
| Let's Encrypt | 0 € |
| **Total** | **~6 €/mois** |

## Limites assumées

- 1 image traitée à la fois (file) ; le 2ᵉ utilisateur attend quelques
  secondes (acceptable au lancement).
- rembg CPU : ~3-10 s/image selon résolution.
- Les routes géométriques (timbres, fenêtres, graphismes plats) sont
  instantanées et ne touchent pas l'IA.