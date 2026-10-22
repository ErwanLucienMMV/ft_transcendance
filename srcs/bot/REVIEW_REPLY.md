J’ai vérifié les remarques : le risque principal était bien réel. Le calcul et
les appels au moteur de règles sont maintenant hors transaction. Une courte
transaction réserve le tour avec un jeton et une expiration ; une autre vérifie
que la position, l’historique et la réservation sont toujours valables avant
d’enregistrer. Un abandon ou un timeout pendant le calcul invalide son résultat,
et une requête dupliquée ne lance pas un deuxième calcul.

Le coup humain accepté ne renvoie plus une erreur lorsque le bot échoue. La
réponse contient l’état sauvegardé avec `botPending`, `botThinking` et `botError` ;
la reprise ne concerne que le tour du bot. Le bot ouvre automatiquement si le
joueur prend les noirs. J’ai aussi ajouté une limite d’une partie bot active par
compte, sérialisée en base, et le refus explicite des propositions de nulle.

Pour le style, les tabs C++ sont conservées et le TypeScript suit à nouveau le
Prettier du backend. `nest_adapter_test.mjs` est branché dans `test:all`, donc dans
`make test` et son conteneur. La description de PR a quitté la racine. Le reset
reprend la liste de tables d’Erwan pour #48, en restant limité au schéma de test.

Les nouveaux tests couvrent ces cas et les routes HTTP du contrôleur. Le détail
des vérifications exécutées figure dans `srcs/bot/VALIDATION.md` ; je ne présente
pas les tests Docker/PostgreSQL comme passés dans mon environnement.

Titre proposé pour BOT-01 : « Compiler et installer le bot maison ». Je ne l’ai
pas modifié dans le tracker externe. Pour #53, il faut bien diffuser tous les
nouveaux plies, et non seulement le dernier. Je laisse l’exclusion ELO des parties
bot à la PR coordonnée avec Erwan.
