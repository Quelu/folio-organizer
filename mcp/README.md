# Folio MCP — ta collection dans Claude Desktop

Petit serveur [MCP](https://modelcontextprotocol.io) local qui donne à Claude Desktop (ou à tout client MCP) un accès en lecture à ta collection Folio : fardes, cartes, emplacements dans les fardes, decks et cartes sorties pour un deck. Tu peux ainsi poser tes questions à Claude avec ton abonnement, sans clé API.

Il lit la **dernière sauvegarde** faite depuis Folio, le catalogue de cartes [Lorcast](https://lorcast.com) et les noms et textes français de [LorcanaJSON](https://lorcanajson.org). Les cartes sont citées en français, avec leur nom anglais entre parenthèses. Il réutilise les règles de l'app (collection multi-fardes, règles de construction de deck, liste de collecte) : les réponses sont les mêmes que dans Folio.

Rien n'est modifié : le serveur ne fait que lire.

## Installation

Node 20 ou plus récent.

```bash
cd mcp
yarn
```

## Sauvegarder ta collection

Folio garde tes données dans le navigateur. Pour que le serveur les voie :

1. Dans Folio, clique **Sauvegarder** en bas de la barre latérale.
2. Le fichier `folio-sauvegarde-AAAA-MM-JJ.json` arrive dans ton dossier de téléchargements.

Le serveur prend toujours la sauvegarde **la plus récente** du dossier, et relit le fichier à chaque question : après une nouvelle sauvegarde, pas besoin de redémarrer Claude Desktop.

### Sauvegarde automatique

Dans Chrome ou Edge, clique **Sauvegarde auto dans un dossier…** en bas de la barre latérale et choisis le dossier lu par le serveur (`FOLIO_BACKUP`, `~/Downloads` par défaut). Folio y écrit `folio-sauvegarde-auto-AAAA-MM-JJ.json` à chaque changement : Claude voit toujours ta collection à jour, sans clic. Un fichier par jour, les jours précédents restent comme historique.

Après un redémarrage du navigateur, il peut redemander l'autorisation d'écrire dans le dossier : la ligne passe en « en pause », un clic suffit pour reprendre.

`FOLIO_BACKUP` peut pointer :

- vers un **dossier** : la sauvegarde `folio-sauvegarde-*.json` la plus récente est utilisée (par défaut `~/Downloads`) ;
- vers un **fichier** précis.

## Configurer Claude Desktop

Ouvre *Réglages → Développeur → Modifier la configuration* (fichier `claude_desktop_config.json`) et ajoute :

```json
{
  "mcpServers": {
    "folio": {
      "command": "node",
      "args": ["/chemin/absolu/vers/folio-organizer/mcp/server.mjs"],
      "env": {
        "FOLIO_BACKUP": "/Users/toi/Downloads"
      }
    }
  }
}
```

Redémarre Claude Desktop : « folio » apparaît dans la liste des outils.

Si Claude Desktop ne trouve pas `node` (installé via nvm par exemple), mets le chemin complet, obtenu avec `which node`.

## Ce que Claude peut faire

| Outil | Rôle |
| --- | --- |
| `list_binders` | Fardes, chapitre, grille, nombre de cartes, complétion |
| `search_cards` | Recherche dans tout le catalogue ou seulement dans ta collection (encres, types, coût, encrable, format…), avec les emplacements dans les fardes |
| `get_card` | Détail d'une carte : texte, légalité, prix indicatif, impressions, exemplaires possédés, decks qui l'utilisent |
| `collection_summary` | Répartition par encre, type et rareté, complétion par chapitre, conflits entre decks |
| `missing_cards` | Cartes manquantes d'une farde, filtrables par rareté, avec la poche prévue |
| `list_decks` | Tes decks et les decks de référence : format, taille, encres, validité, part possédée |
| `get_deck` | Analyse d'un deck : courbe, encres, erreurs, cartes possédées ou manquantes |
| `check_deck_list` | « Puis-je monter ce deck ? » : colle une liste trouvée en ligne |
| `pull_list` | Où aller chercher chaque carte d'un deck, farde par farde, page par page |

Les cartes sont citées `[chapitre-numéro] Nom - Version`, par exemple `[1-42] Elsa - Spirit of Winter`.

Les prix viennent de Lorcast (TCGplayer, en dollars) : c'est un ordre de grandeur, pas le prix Cardmarket.

## Exemples de questions

- « Avec mes cartes Améthyste et Acier, propose-moi un deck Core de 60 cartes. »
- « Quelles cartes me manquent pour monter cette liste ? » (puis colle la liste)
- « Où sont rangées mes Elsa ? »
- « Quelles légendaires me manquent dans ma farde du Premier Chapitre ? »
- « Mon deck Rubis/Saphir est-il légal en Core ? Que faut-il remplacer ? »
- « Donne-moi la liste de collecte du deck Elsa Améthyste. »

## Cache

Le catalogue Lorcast (un chapitre à la fois) et les textes français de LorcanaJSON sont téléchargés au premier lancement, puis gardés deux jours dans `~/.cache/folio-mcp/catalog.json`. Les légalités Core / Infinity et la rotation viennent aussi de LorcanaJSON, à jour dès la sortie d'un chapitre. Pour récupérer un nouveau chapitre sans attendre, supprime ce fichier : il est retéléchargé à la question suivante. Hors ligne, le serveur utilise le dernier catalogue en cache.
