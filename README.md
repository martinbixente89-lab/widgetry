# Widgetry

Widgets personnalisables dans les notes Obsidian : horloge, compte à rebours et citations.

> **Version 0.1.0 — première version.** Essais réels réalisés uniquement sous **macOS 27.2 avec Obsidian 1.15.0**.
> Windows, Linux et les autres versions d'Obsidian ne sont **pas vérifiés**. Ordinateur uniquement.

## Fonctionnalités

- **Horloge** : heure de l'ordinateur qui affiche la note, format 12 h ou 24 h, secondes facultatives.
- **Compte à rebours** : titre, date et heure d'échéance. À l'échéance, le compteur reste à `00:00:00` et affiche « Échéance atteinte », sans son ni notification.
- **Citations** : une citation fixe, ou une liste personnelle affichée dans l'ordre, à intervalle réglable (de 5 à 86 400 secondes, 30 par défaut). Les citations peuvent tenir sur plusieurs lignes.
- **Apparence** : couleurs du thème Obsidian, taille petite, moyenne ou grande, alignement à gauche, au centre ou à droite.
- **Formulaire avec aperçu** pour insérer un widget, puis pour le modifier.

## Utilisation

1. Ouvrez une note en mode édition et placez le curseur à l'endroit voulu, sans sélectionner de texte.
2. Lancez la commande **Widgetry: Insérer un widget** depuis la palette de commandes.
3. Choisissez le type, réglez-le en regardant l'aperçu, puis sélectionnez **Insérer**.
4. Pour modifier un widget, survolez-le et sélectionnez l'icône crayon en bas à gauche du widget.

Chaque widget est un bloc de code `widgetry` contenant du JSON :

````markdown
```widgetry
{
  "type": "countdown",
  "title": "Vacances",
  "target": "2026-12-20T18:00:00+01:00",
  "size": "medium",
  "align": "center"
}
```
````

Si le plugin est désactivé, le bloc reste visible comme un simple bloc de code. Rien n'est perdu.

### Échéance du compte à rebours

L'échéance est enregistrée comme un instant absolu, avec son décalage par rapport à UTC. Elle tombe donc au même moment sur tous les ordinateurs, quel que soit leur fuseau horaire.

Les heures qui n'existent pas (passage à l'heure d'été) ou qui existent deux fois (retour à l'heure d'hiver) sont refusées par le formulaire.

## Protection du contenu des notes

- L'insertion n'écrase jamais de texte : elle est refusée si du texte est sélectionné.
- Avant de modifier un widget, le plugin vérifie la note, la position et le contenu exact du bloc. À la moindre différence, la modification est refusée sans rien écrire.
- Seul le contenu du bloc est remplacé. Les délimiteurs et le reste de la note ne changent pas.
- Une note ouverte en édition est modifiée par son éditeur. Depuis un panneau en lecture, la modification est refusée si la même note est ouverte en édition dans un autre panneau.
- La modification est refusée depuis une note intégrée dans une autre.
- Les champs inconnus du bloc sont conservés avec leurs valeurs. La mise en forme du JSON est normalisée (indentation, espaces, écriture des nombres et des échappements).
- Le formulaire refuse de réécrire un bloc dont il ne peut pas conserver les valeurs :
  - JSON invalide, y compris avec des commentaires ;
  - clés en double ;
  - clé `__proto__` ;
  - champ connu du mauvais type ;
  - nombres trop précis ou hors limites, et `-0`.

Ces contrôles réduisent les risques de perte, mais ne constituent pas une garantie universelle.

## État des vérifications (version 0.1.0)

### Tests automatiques

63 tests automatiques (Vitest) réussissent. Ils couvrent la logique sans Obsidian :

- lecture, validation et écriture du JSON, avec les contrôles ci-dessus ;
- calcul des échéances, des fuseaux horaires et des changements d'heure ;
- rotation des citations ;
- remplacement vérifié d'un bloc et insertion dans le texte d'une note.

Ces tests ne remplacent pas les essais dans Obsidian.

### Essais réels dans Obsidian

Les essais ont été réalisés sous **macOS 27.2 (Apple Silicon) avec Obsidian 1.15.0** (programme d'installation 1.14.4), dans un coffre de test dédié. Ils ont été vérifiés :

- l'insertion des trois types de widgets et leur affichage ;
- la rotation des citations et les citations sur plusieurs lignes ;
- la modification en aperçu en direct et en mode lecture ;
- la préservation du texte autour des blocs ;
- les refus décrits plus haut (sélection, bloc modifié pendant l'ouverture du formulaire, note changée dans le panneau, note intégrée, note ouverte en édition ailleurs, blocs invalides) ;
- la conservation d'un champ inconnu ;
- le passage à zéro d'un compte à rebours.

Les variantes visuelles ont été vérifiées sur **neuf combinaisons représentatives** : chaque type dans chaque taille et chaque alignement, mais pas les 27 combinaisons possibles.

### Non vérifié ou partiellement vérifié

- **Windows et Linux** : non vérifiés.
- **Autres versions d'Obsidian** : non vérifiées. La version minimale déclarée (1.15.0) est celle des essais.
- **Mobile** : non pris en charge.
- **Minuteries** : partiellement vérifiées. Après fermeture du formulaire, suppression du widget, fermeture de la note ou désactivation du plugin, l'affichage du widget retiré ne se met plus à jour. Cela ne prouve pas à lui seul que chaque minuterie a été effectivement annulée.
- **Export PDF** : non vérifié.
- **Aperçu au survol et Canvas** : la modification y est refusée par conception, mais ce refus n'a pas été vérifié dans Obsidian.
- **Synchronisation** entre appareils (Obsidian Sync ou autre) : non vérifiée.
- **Absence de son** à l'échéance : non observable pendant les essais (le plugin ne contient aucun son).

## Limites connues

- **Annulation (Cmd/Ctrl+Z)** :
  - Une insertion et une modification faites en mode édition s'annulent et se rétablissent.
  - Après la fermeture du formulaire, il faut d'abord cliquer dans la note : le focus n'y revient pas automatiquement.
  - Une modification faite en mode lecture ne s'annule pas avec Cmd/Ctrl+Z.
- **Focus** : après la fermeture du formulaire, le focus revient sur le crayon. Appuyer sur Espace ou Entrée rouvre alors le formulaire.
- **Fermeture du panneau d'origine pendant l'édition** : impossible pendant que le formulaire est ouvert, donc non testée.
- **Hauteur variable** : quand les citations en rotation n'ont pas la même hauteur, le texte situé sous le widget se décale. L'apparition de la ligne « Échéance atteinte » décale aussi légèrement le contenu.
- **Rendu masqué** : dans une note affichée en lecture, le rendu « édition » masqué d'un widget peut continuer à se mettre à jour tant qu'Obsidian n'a pas réaffiché l'éditeur.
- Interface en français uniquement.
- Le crayon n'apparaît qu'au survol du widget.

## Installation manuelle

1. Téléchargez `main.js`, `manifest.json` et `styles.css` depuis la release GitHub de la version voulue.
2. Copiez-les dans `<coffre>/.obsidian/plugins/widgetry/`.
3. Redémarrez Obsidian ou rechargez les modules, puis activez **Widgetry** dans **Réglages → Modules complémentaires**. Le mode restreint doit être désactivé pour ce coffre.

Conseil : essayez d'abord le plugin dans un coffre de test.

## Développement

Node 24 est utilisé localement et dans la vérification automatique.

```bash
npm install
npm test        # tests automatiques (Vitest)
npm run lint
npm run build   # produit main.js
```

## Licence

MIT — voir [LICENSE](LICENSE).
