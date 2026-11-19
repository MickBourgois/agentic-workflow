import { codeBlock, escapeHtml, icon, routeLabel, shell } from './ui.mjs'
import { skills } from './home.mjs'

export const docNavigation = [
  { slug: '', title: 'Bienvenue', group: 'DÉMARRER', icon: 'book' },
  { slug: 'installation', title: 'Installation', group: 'DÉMARRER', icon: 'terminal' },
  { slug: 'workflow', title: 'Votre première carte', group: 'COMPRENDRE', icon: 'branch' },
  { slug: 'routage', title: 'Complexité & modèles', group: 'COMPRENDRE', icon: 'grid' },
  { slug: 'agents', title: 'Agents & contextes', group: 'COMPRENDRE', icon: 'layers' },
  { slug: 'skills', title: 'Skills & commandes', group: 'RÉFÉRENCE', icon: 'code' },
  { slug: 'configuration', title: 'Configuration & update', group: 'RÉFÉRENCE', icon: 'refresh' },
]

function sources(context, paths) {
  return `<div class="source-links"><span>SOURCE DE VÉRITÉ</span>${paths.map((path) => `<a href="${context.repository}/blob/main/${path}">${escapeHtml(path)} ${icon('external')}</a>`).join('')}</div>`
}

function pages(context) {
  const u = (path) => `${context.basePath}${path}`
  const callout = (title, body) => `<aside class="callout"><strong>${title}</strong><p>${body}</p></aside>`
  const section = (id, title, body) => ({ id, title, body })
  return {
    '': {
      label: 'Démarrer', title: 'Une méthode pour vos agents.', description: 'Démarrer une carte prête, relire son commit et confirmer sa livraison avec des preuves adaptées au risque.',
      sections: [
        section('vue-ensemble', 'Le parcours d’une carte prête', `
<p>Choisissez une carte Linear exécutable et lancez <code>/start-card</code>. L’orchestrateur vérifie qu’elle peut démarrer, établit son routage et ouvre ou reprend son worktree. Le risque détermine le modèle, l’effort de raisonnement et le nombre de reviewers par tour.</p>
<div class="doc-flow">${['Démarrer', 'Implémenter', 'Relire', 'Valider', 'Livrer'].map((label, i) => `<span><small>0${i + 1}</small>${label}</span>`).join('')}</div>
<p>La revue indépendante et les preuves de validation sont requises. Le hardening sert à clarifier une carte. Une correction s’ajoute uniquement quand un défaut bloque. <a href="${u('/docs/workflow/#obligatoire')}">Voir ce qui est obligatoire, conditionnel ou facultatif</a>.</p>`),
        section('par-ou-commencer', 'Le bon point de départ', `<div class="doc-card-grid"><a href="${u('/docs/installation/')}">${icon('terminal')}<h3>Installer le workflow</h3><p>Préparer votre repository et votre équipe Linear.</p><span>Commencer ${icon('arrow')}</span></a><a href="${u('/docs/workflow/')}">${icon('branch')}<h3>Livrer une première carte</h3><p>Suivre le parcours du ticket au merge confirmé.</p><span>Découvrir le parcours ${icon('arrow')}</span></a><a href="${u('/docs/routage/')}">${icon('grid')}<h3>Comprendre le routage</h3><p>Explorer les quatre niveaux et leurs reviews.</p><span>Voir les règles ${icon('arrow')}</span></a><a href="${u('/docs/skills/')}">${icon('code')}<h3>Consulter les skills</h3><p>Lire les entrées, sorties et limites de chaque phase.</p><span>Ouvrir la référence ${icon('arrow')}</span></a></div>`),
        section('prerequis', 'Ce dont vous avez besoin', `<ul><li>Un repository Git et <strong>Node.js 20 ou plus</strong>.</li><li>Le CLI Codex pour l’orchestration automatique.</li><li>Un accès Linear exposant les opérations sur les issues, commentaires, labels et relations.</li><li>Les modèles du routage disponibles sur votre hôte Codex.</li></ul>${callout('Claude Code', 'Les commandes Claude donnent accès aux mêmes contrats de phase. Le runner automatique de cette version utilise Codex ; il ne lance pas Claude.')}`),
      ], source: ['README.md', 'workflow/contracts/delivery.md'],
    },
    installation: {
      label: 'Démarrer', title: 'Installez. Configurez. Commencez.', description: 'La source officielle reste dans son propre dépôt. Chaque projet reçoit une copie gérée et une petite configuration qui lui appartient.',
      sections: [
        section('cloner', '1. Cloner la source', `${codeBlock(`git clone ${context.repository}.git\ncd agentic-workflow`)}<p>Pour un usage reproductible, vous pouvez choisir un tag de release existant. La version du workflow est déclarée dans <code>VERSION</code>.</p>`),
        section('installer', '2. Installer dans votre projet', `${codeBlock('./install.sh /chemin/vers/votre-projet')}<p>Le chemin doit désigner la racine d’un repository Git existant. L’installateur indique les fichiers créés, mis à jour et les conflits éventuels.</p><div class="table-scroll"><table><thead><tr><th>Emplacement</th><th>Ce qu’il contient</th></tr></thead><tbody><tr><td><code>.agents/skills/</code></td><td>Les skills canoniques</td></tr><tr><td><code>.codex/agents/</code></td><td>Les quatre agents Codex</td></tr><tr><td><code>.claude/commands/</code></td><td>Les commandes Claude Code</td></tr><tr><td><code>.agent-workflow/</code></td><td>Le runtime, les contrats et le manifest</td></tr><tr><td><code>agent-workflow.config.json</code></td><td>Votre configuration projet</td></tr></tbody></table></div><p>Si un conflit est signalé, comparez le fichier conservé à la version entrante indiquée par l’installateur avant de continuer.</p>`),
        section('linear', '3. Configurer l’équipe Linear', `
<p>Renseignez <code>tracker.team</code> dans <code>agent-workflow.config.json</code>. La session doit pouvoir lire et modifier les issues, les statuts, les labels, les commentaires et les relations de cette équipe.</p>
${codeBlock(JSON.stringify({ tracker: { provider: 'linear', team: 'Votre équipe' } }, null, 2), 'agent-workflow.config.json')}
<p>Pour une carte choisie explicitement, utilisez le statut prêt ou backlog défini par le projet et vérifiez les dépendances. Les labels <code>hardened</code> et <code>ready-for-agent</code>, ainsi qu’un routage enregistré, sont requis pour la sélection automatique du backlog.</p>
${callout('Règles du projet', 'Committez les fichiers installés et la configuration projet. Conservez les conventions métier et les checks requis dans AGENTS.md ou CLAUDE.md.')}`),
        section('premiere-carte', '4. Démarrer une première carte', `
<p>Dans une session ouverte sur votre projet, lancez la commande avec un identifiant Linear réel.</p>
${codeBlock('/start-card PROJ-123', 'Dans votre assistant')}
<p>Le démarrage vérifie le périmètre, l’acceptation et les bloqueurs avant le travail Git. Si le résultat attendu ou son mode de vérification est incertain, précisez la carte ou utilisez <code>/harden-card</code>. <a href="${u('/docs/workflow/')}">Suivre le parcours d’une carte</a>.</p>`),
      ], source: ['scripts/agent-workflow.mjs', 'workflow/templates/agent-workflow.config.json'],
    },
    workflow: {
      label: 'Comprendre', title: 'Du ticket à la livraison confirmée.', description: 'Une orchestration est toujours limitée à une carte, une branche, un worktree et une pull request.',
      sections: [
        section('harden', 'Clarifier le ticket si nécessaire', `
<p><strong>Facultatif</strong> pour une carte sélectionnée explicitement. Un résultat observable, un périmètre délimité et une façon concrète de vérifier le changement suffisent à préparer une carte. Le démarrage vérifie aussi son statut, ses relations bloquantes et les règles du projet.</p>
<p>Utilisez <code>/harden-card</code> quand un élément manque. Le hardening conserve le texte et les critères acceptés et propose le plus petit ajout utile. Une décision bloquante revient à l’humain. Pour un démarrage direct, <code>/start-card</code> enregistre lui-même le routage dans le commentaire Linear <code>delivery-routing:v1</code> si nécessaire.</p>`),
        section('obligatoire', 'Obligatoire, selon le cas ou facultatif', `
<div class="table-scroll"><table><thead><tr><th scope="col">Étape</th><th scope="col">Quand elle s’applique</th></tr></thead><tbody>
<tr><td>Préparation du ticket et routage</td><td><strong>Obligatoires.</strong> Une carte prête passe par <code>/start-card</code>. La commande dédiée <code>/harden-card</code> est facultative.</td></tr>
<tr><td>Implémentation et contrôles ciblés</td><td><strong>Obligatoires.</strong> Le commit et ses preuves doivent être prêts avant la revue. Le build avant commit et le TDD dépendent du projet, de la carte et du changement.</td></tr>
<tr><td>Revue indépendante</td><td><strong>Obligatoire.</strong> Un reviewer par tour, deux en parallèle pour <code>critical</code>. Chaque reçu identifie le commit examiné.</td></tr>
<tr><td>Correction et nouvelle revue</td><td><strong>Si un défaut bloque.</strong> Au plus une correction automatique pour une nouvelle carte. Une suggestion facultative laisse l’approbation possible.</td></tr>
<tr><td>Validation requise avant livraison</td><td><strong>Obligatoire.</strong> Une preuve ciblée approuvée peut suffire pour une nouvelle carte simple ou standard éligible. Les autres cas passent par un contrôle séparé.</td></tr>
<tr><td>Checks CI et production</td><td><strong>Selon le projet.</strong> Les checks requis de la PR passent avant la fusion. Un projet qui déploie vérifie le commit livré et les smokes requis.</td></tr>
<tr><td>Backlog automatique et régressions planifiées</td><td><strong>Facultatifs.</strong> La boucle de backlog enchaîne des cartes éligibles. Les régressions planifiées tournent en arrière-plan.</td></tr>
</tbody></table></div>`),
        section('lancer', 'Lancer ou reprendre une carte', `
<p>Choisissez la commande de l’assistant ou le runner CLI depuis le dépôt du projet. Dans les deux cas, l’orchestration porte sur un seul identifiant de carte.</p>
${codeBlock('/start-card PROJ-123', 'Dans votre assistant')}
${codeBlock('node .agent-workflow/bin/run-card.mjs PROJ-123', 'Dans le terminal')}
<p>Le runner lance un processus Codex neuf. À la reprise, <code>/start-card</code> recoupe les branches, commits, PR et preuves déjà enregistrés avant de reprendre la phase utile.</p>
${codeBlock('node .agent-workflow/bin/run-card.mjs PROJ-123 --dry-run', 'Facultatif · prévisualiser la commande')}`),
        section('reviews', 'Implémenter, relire, corriger', `
<ol>
<li>L’implémenteur vise le plus petit changement qui satisfait la carte. Il vérifie les cas utiles, crée un commit et conserve les résultats des contrôles ciblés sur ce commit. Il suit les exigences de TDD ou de build explicites du projet ou de la carte.</li>
<li>Chaque reviewer travaille en contexte neuf et en lecture seule. Il vérifie le comportement attendu, les risques pertinents du diff et les preuves du commit courant. Son reçu indique <code>scope: code_and_focused_checks</code>.</li>
<li>Un défaut concret P0 à P2 peut bloquer la livraison et justifier une correction. Les conseils P2 ou P3 et les améliorations facultatives laissent l’approbation possible.</li>
<li>Une seule correction automatique regroupe les défauts confirmés. La revue suivante vise le correctif et ses effets si ce périmètre est vérifiable. En cas de risque sensible, d’impact incertain ou de contexte manquant, elle reprend le diff de la carte. Un nouveau commit exige des preuves et des approbations pour son propre SHA.</li>
</ol>
<p>Une nouvelle carte a au plus <strong>deux tours de revue</strong>. Si un blocage persiste ou si les reviewers se contredisent, l’orchestrateur demande un arbitrage humain. Une carte reprise garde le plafond enregistré.</p>`),
        section('validation', 'Approuver la validation locale', `
<p>Après toutes les approbations du code, l’orchestrateur passe à <code>VALIDATING</code>. Il vérifie la preuve sur la base et le commit exacts avant de passer à <code>APPROVED</code>.</p>
<ul>
<li><strong>Simple ou standard éligible.</strong> Les contrôles ciblés déjà approuvés peuvent satisfaire la validation locale si les preuves sont fraîches, couvrent le diff et répondent aux exigences du projet. Le profil est <code>reviewed-focused</code>.</li>
<li><strong>Contrôle séparé.</strong> Les travaux complexes, sensibles ou incertains requièrent une validation distincte. Une carte critique requiert le contrôle complet. Un projet peut configurer une sélection éprouvée des contrôles quand le risque le permet.</li>
</ul>
${callout('Exemple', 'Un libellé de formulaire peut réutiliser un test ciblé sur ce libellé. Une modification des autorisations exige deux revues indépendantes et le contrôle complet.')}`),
        section('ci', 'CI de PR, production et régressions', `
<div class="table-scroll"><table><thead><tr><th scope="col">Moment</th><th scope="col">Contrôle</th><th scope="col">Effet sur la livraison</th></tr></thead><tbody>
<tr><td>Ouverture ou mise à jour de la PR</td><td>Tests essentiels, qualité et preuves ciblées selon le risque. Par exemple, lint et typage si le projet les requiert.</td><td>Les checks définis comme requis par le dépôt conditionnent la fusion.</td></tr>
<tr><td>Après fusion</td><td>Confirmer le déploiement du commit fusionné et la réussite du smoke, par exemple sur un endpoint de santé.</td><td>Requis avant <code>DONE</code> si le projet exige le déploiement et le smoke.</td></tr>
<tr><td>Exécution planifiée ou manuelle</td><td>Suite de régression large en arrière-plan sur une révision connue, par exemple sur <code>main</code> toutes les six heures.</td><td>Suivi séparé de la livraison de la carte.</td></tr>
</tbody></table></div>
<p>Le dépôt consommateur règle les workflows, les protections de fusion, le calendrier et les limites de temps. Si une intégration d’hébergement publie des revues automatiques, leurs avis sont consultatifs. Le workflow utilise ses propres revues indépendantes pour approuver le commit.</p>`),
        section('terminer', 'Livrer, nettoyer et clôturer', `
<p>Le shipper vérifie les preuves de validation, attend les checks requis de la PR et confirme la fusion sur la branche cible. Si un déploiement est requis, il vérifie le déploiement du commit fusionné et son smoke.</p>
<p>Il archive les preuves sous <code>.delivery/archives/&lt;CARD&gt;/evidence/</code> dans le dépôt de départ. Après confirmation de la fusion et vérification de cette archive, il retire le worktree propre et inactif avec <code>git worktree remove</code>. Un worktree actif ou modifié est conservé. Une fusion effectuée directement sur GitHub peut laisser un worktree en place tant que la phase de livraison attend sa reprise.</p>
<div class="state-grid"><span><strong>DONE</strong>Livraison et preuves confirmées</span><span><strong>NEEDS_HUMAN</strong>Décision ou preuve humaine</span><span><strong>FAILED</strong>Échec non récupérable</span></div>
<p>Ces états terminent l’orchestration de cette carte. La boucle de backlog est le point d’entrée distinct qui peut choisir la suivante.</p>`),
        section('backlog', 'Enchaîner des cartes prêtes avec le backlog', `
<p><strong>Facultatif.</strong> La sélection automatique exige une équipe Linear configurée, les labels de disponibilité et un commentaire de routage pour la carte. Elle ouvre un processus neuf pour chaque carte éligible et s’arrête à la première intervention nécessaire, ou à la limite demandée.</p>
${codeBlock('node .agent-workflow/bin/backlog-loop.mjs --max-cards 3')}
<p>Les sorties et preuves locales sont stockées dans <code>.delivery/</code>, ignoré par Git.</p>`),
      ], source: ['workflow/skills/start-card/SKILL.md', 'workflow/contracts/delivery.md'],
    },
    routage: {
      label: 'Comprendre', title: 'La rigueur suit le risque.', description: 'La classification est établie à partir du ticket et du code. La table ci-dessous est générée depuis les routes exécutables du workflow.',
      sections: [
        section('niveaux', 'Quatre niveaux, des routes explicites', `<div class="table-scroll"><table><thead><tr><th>Niveau</th><th>Implémentation</th><th>Review indépendante</th></tr></thead><tbody>${Object.entries(context.routes).map(([name, route]) => `<tr><td><span class="level-chip">${name}</span></td><td>${routeLabel(route.implementation)}${name === 'complex' ? '<small class="table-note">high selon l’effort requis</small>' : ''}</td><td>${route.reviewers.map(routeLabel).join('<br>')}</td></tr>`).join('')}</tbody></table></div><p>Les modèles exacts et les routes fixes sont également accessibles dans le runtime installé :</p>${codeBlock('node .agent-workflow/bin/agent-workflow.mjs routes')}`),
        section('choix-modeles', 'Comment sont choisis les modèles ?', `
<p>Luna 6 implémente les changements simples et standard. Sol 6.1 intervient pour la revue standard, les changements complexes et les contrats sensibles. En <code>critical</code>, Sol 6.1 et Sol 6 assurent deux revues indépendantes du même commit.</p>
<p>Le niveau de raisonnement s’ajuste au rôle et au risque. Les modèles et les niveaux exacts figurent dans le tableau, généré depuis la configuration canonique.</p>`),
        section('critique', 'Quand une carte devient critical', `
<p>Au démarrage, l’orchestrateur recherche d’abord un risque sensible ou irréversible dans le ticket et le code. Autorisations, paiements, migrations destructrices, confidentialité, intégrité des données et infrastructure de production peuvent justifier <code>critical</code>.</p>
<p>La classification identifie le contrat modifié et un mode de défaillance plausible. Une carte critique exige deux revues indépendantes par tour et le contrôle complet avant livraison.</p>`),
        section('score', 'Huit dimensions pour les autres changements', `
<div class="table-scroll"><table><thead><tr><th scope="col">Dimension</th><th scope="col">Score</th></tr></thead><tbody>${[['Surface du changement et nombre de couches', '0–3'], ['Complexité de la logique métier', '0–3'], ['Dépendances externes', '0–2'], ['Asynchrone, concurrence, relances et ordre', '0–2'], ['Risque de régression', '0–3'], ['Difficulté de test', '0–2'], ['Ambiguïté restante', '0–2'], ['Étendue de l’impact', '0–3']].map(([dimension, range]) => `<tr><td>${dimension}</td><td>${range}</td></tr>`).join('')}</tbody></table></div>
<p>Le score donne <strong>simple de 0 à 4</strong>, <strong>standard de 5 à 10</strong> et <strong>complex de 11 à 20</strong>. Une décision bloquante revient à l’humain avant l’implémentation.</p>`),
        section('reasoning', 'Raisonnement, correction et escalade', `
<p>Pour <code>complex</code>, l’implémentation utilise <code>high</code> à partir de 15 points ou si l’ambiguïté, la difficulté de test ou le risque de régression atteint 2. La correction reprend la route d’implémentation.</p>
<p>Un échec d’implémentation répété avec la même empreinte peut déclencher une unique escalade vers Sol 6.1 / high. Cette reprise est distincte de la correction après revue. Un échec persistant demande un arbitrage humain.</p>
<p>L’orchestrateur utilise ${routeLabel(context.fixed.orchestrator)} et le shipper ${routeLabel(context.fixed.shipper)}. Le sélecteur de backlog utilise ${routeLabel(context.fixed.backlogSelector)}.</p>
${callout('Disponibilité des modèles', 'Vérifiez que les identifiants des modèles routés sont disponibles sur votre hôte avant de lancer la livraison.')}`),
      ], source: ['workflow/config/defaults.mjs', 'workflow/orchestrator/delivery-state.mjs'],
    },
    agents: {
      label: 'Comprendre', title: 'Des rôles séparés. Un cap commun.', description: 'Chaque rôle traite un commit ou une étape précise dans un contexte séparé.',
      sections: [
        section('roles', 'Les quatre agents de livraison', `<div class="agent-reference">${[
          ['implementer', 'Implémenter', 'Reçoit le ticket, le worktree, la branche, le SHA de base et sa route. Retourne un commit et les preuves ciblées qui lui correspondent.'],
          ['reviewer', 'Relire', 'Reçoit le ticket, le worktree, les SHAs base/head et un slot. Lit le code sans le modifier et rend un reçu structuré.'],
          ['reworker', 'Corriger', 'Reçoit le commit relu et les findings confirmés. Intervient si un défaut confirmé bloque et produit un commit de correction avec de nouvelles preuves.'],
          ['shipper', 'Livrer', 'Reçoit le commit approuvé et les reçus correspondants. Suit la PR et ses checks requis, puis confirme la fusion, l’éventuel déploiement et le nettoyage du worktree.'],
        ].map(([agent, label, description]) => `<article><code>${agent}</code><h3>${label}</h3><p>${description}</p></article>`).join('')}</div>`),
        section('contextes', 'Ce qui traverse un passage de relais', `
<p>Chaque agent consulte directement le ticket, les instructions du projet et l’état Git. Le reviewer part du diff et de ses preuves, dans un contexte séparé de l’implémentation. Pour une correction délimitée, il peut relire son propre reçu précédent et les changements depuis le dernier commit examiné.</p>
<p>En <code>critical</code>, les reviewers A et B examinent en parallèle le même commit avec des modèles distincts. Les désaccords qui bloquent la livraison reviennent à l’humain.</p>
${codeBlock('card: PROJ-123\nstatus: approved\nreviewed_head: <sha>\nreviewer_slot: single\nscope: code_and_focused_checks\nfindings: []\nsuggestions: []', 'Exemple de reçu de revue')}`),
        section('memoire', 'Reprendre depuis les preuves', `
<p>La préparation Git doit réussir avant la création de l’état local et du checkpoint partagé. Le workflow reprend un état existant à partir des branches, des commits, de la PR et des checks actuels.</p>
<p>Le routage et la progression sont consignés dans Linear. Les reçus restent dans l’état local pendant les revues et la validation de façon à préserver l’indépendance des reviewers. Le couple base et commit identifie la preuve applicable.</p>
<p>Lors de la clôture, le shipper archive les preuves vérifiées dans le dépôt de départ avant de retirer le worktree propre et inactif de la carte fusionnée.</p>`),
      ], source: ['workflow/agents/codex', 'workflow/contracts/delivery.md'],
    },
    skills: {
      label: 'Référence', title: 'Six commandes, un même contrat.', description: 'Démarrez avec /start-card pour déléguer les phases requises. Les commandes de phase sont aussi disponibles séparément pour un usage manuel.',
      sections: skills.map((skill) => section(skill.name, `/${skill.name}`, `<p><strong>${skill.usage}</strong></p><p class="skill-doc-lead">${skill.title}</p><p>${skill.description}</p>${codeBlock(skill.name === 'code-review' ? '/code-review PROJ-123, base <sha>, head <sha>, slot single' : skill.name === 'rework' ? '/rework PROJ-123 at <sha> using <structured findings>' : skill.name === 'implement' ? '/implement PROJ-123 in <worktree>, base <sha>, route <model/reasoning>' : skill.name === 'ship-production-change' ? '/ship-production-change PROJ-123 at approved head <sha>' : `/${skill.name} PROJ-123`, 'Commande')}<a class="source-skill" href="${context.repository}/blob/main/workflow/skills/${skill.name}/SKILL.md">Lire le contrat complet ${icon('external')}</a>${skill.name === 'harden-card' ? '<p>Utilisez cette commande si une carte demande une clarification. Une carte déjà prête peut passer par /start-card.</p>' : ''}`)),
      source: ['workflow/skills', 'workflow/commands/claude'],
    },
    configuration: {
      label: 'Référence', title: 'Votre projet garde ses réglages.', description: 'Le moteur est partagé. Les conventions du projet et les paramètres de votre machine restent dans leurs propres fichiers.',
      sections: [
        section('couches', 'Trois couches de configuration', `<ol><li><strong>Défauts du workflow</strong> — versionnés dans la source centrale.</li><li><strong>Projet</strong> — <code>agent-workflow.config.json</code>, committé dans le dépôt du projet.</li><li><strong>Machine</strong> — <code>.agent-workflow.local.json</code>, prioritaire et gitignoré.</li></ol><p>Le workflow détecte la branche de base, le gestionnaire de paquets et les scripts habituels. Configurez une valeur explicite quand cette détection ne correspond pas à votre projet.</p>${codeBlock(JSON.stringify({ tracker: { team: 'Votre équipe' }, git: { baseBranch: 'auto' }, commands: { install: 'auto', fullCheck: 'npm run check' } }, null, 2), 'Configuration minimale personnalisée')}`),
        section('preuves', 'Preuves requises et vérifications optionnelles', `
<p>Pour les nouvelles livraisons, les commandes ciblées et la validation locale laissent des preuves brutes liées à l’état Git. <code>delivery-evidence.mjs</code> enregistre les sorties des commandes et les artefacts requis dans des dossiers privés. Le CLI vérifie les empreintes du commit et l’archive avant <code>DONE</code>.</p>
<p>Deux extensions de projet sont <strong>facultatives</strong>. <code>commands.validationProof</code> lie et vérifie le reçu d’un contrôle exécuté séparément. <code>commands.completionCheck</code> réconcilie les preuves avant <code>DONE</code>. Quand elles sont activées, un échec bloque la phase correspondante.</p>
<p><code>delivery.validationMode</code> vaut <code>full</code> par défaut pour les contrôles séparés. Le mode <code>project</code> requiert une politique de sélection testée et un retour au contrôle complet en cas de risque ou de doute. Le profil <code>reviewed-focused</code> réutilise les preuves approuvées des nouvelles cartes simples ou standard éligibles.</p>
<p>Une nouvelle livraison autorise au plus une correction automatique. Définissez <code>maxReworkCycles: 0</code> pour demander une intervention humaine dès la première revue bloquante. Les cartes en cours conservent leur limite enregistrée.</p>
${codeBlock('node .agent-workflow/bin/delivery-state.mjs summary --card PROJ-123', 'Facultatif · résumer la livraison')}
<p><a href="${context.repository}/blob/main/workflow/contracts/project-integration.md">Consulter le contrat d’intégration du projet</a>.</p>`),
        section('verification', 'Consulter la configuration effective', `${codeBlock('node .agent-workflow/bin/agent-workflow.mjs config')}<p>La commande s’exécute depuis la racine du projet et fusionne les trois couches. Le détail des options est disponible dans le <a href="${context.repository}/blob/main/docs/CONFIGURATION.md">guide de configuration du repository</a>.</p>`),
        section('update', 'Mettre à jour un projet', `<p>Dans votre clone de la source officielle :</p>${codeBlock('git pull --rebase\n./update.sh /chemin/vers/votre-projet')}<p>Le manifest compare les empreintes des fichiers actuels, de la dernière installation et de la version entrante. La configuration reste gérée par le projet.</p>`),
        section('conflits', 'Résoudre un conflit explicitement', `<p>Un fichier géré modifié manuellement reste en place. La version entrante est enregistrée dans <code>.agent-workflow/conflicts/</code> et la commande retourne le code 2.</p><ol><li>Comparez le fichier local et le chemin <code>incoming</code> indiqué par le manifest.</li><li>Décidez des changements à conserver.</li><li>Relancez l’update. Un fichier identique à la version entrante est à nouveau reconnu comme géré.</li></ol><p>Les fichiers gérés devenus obsolètes et restés intacts sont déplacés dans <code>.agent-workflow/backups/</code>.</p>${callout('Les secrets restent locaux', 'L’installateur ne copie ni .env ni identifiants. La configuration environment.copyFiles décrit uniquement les noms des fichiers autorisés dans les worktrees de livraison ; leur contenu reste hors de la source officielle.')}`),
      ], source: ['docs/CONFIGURATION.md', 'docs/MANAGED-FILES.md'],
    },
  }
}

export function docsPage(slug, context) {
  const page = pages(context)[slug]
  const index = docNavigation.findIndex((entry) => entry.slug === slug)
  const u = (path) => `${context.basePath}${path}`
  let previousGroup = ''
  const nav = docNavigation.map((entry) => {
    const heading = previousGroup === entry.group ? '' : `<p class="sidebar-group">${entry.group}</p>`
    previousGroup = entry.group
    return `${heading}<a ${entry.slug === slug ? 'aria-current="page"' : ''} href="${u(`/docs/${entry.slug ? `${entry.slug}/` : ''}`)}">${icon(entry.icon)}${entry.title}</a>`
  }).join('')
  const neighbor = (entry, direction) => entry ? `<a href="${u(`/docs/${entry.slug ? `${entry.slug}/` : ''}`)}"><small>${direction}</small><strong>${entry.title} ${icon('arrow')}</strong></a>` : '<span></span>'
  const content = `<main id="main" class="docs-layout page-width"><aside class="docs-sidebar"><div class="docs-sidebar-label">LA DOCUMENTATION <span>v${escapeHtml(context.version)}</span></div><nav aria-label="Chapitres de la documentation">${nav}</nav><div class="sidebar-github">${icon('github')}<p>Un workflow ouvert.<br>Des contributions bienvenues.</p><a href="${context.repository}">Explorer le repository ${icon('external')}</a></div></aside><article class="doc-article"><div class="breadcrumb"><a href="${u('/docs/')}">Documentation</a><span>/</span><span>${page.label}</span></div><h1>${page.title}</h1><p class="doc-description">${page.description}</p><div class="mobile-toc"><details><summary>Sur cette page</summary><nav aria-label="Sommaire mobile">${page.sections.map((s) => `<a href="#${s.id}">${s.title}</a>`).join('')}</nav></details></div>${page.sections.map((s) => `<section id="${s.id}" class="doc-section"><h2>${s.title}</h2>${s.body}</section>`).join('')}${sources(context, page.source)}<nav class="doc-pagination" aria-label="Pages voisines">${neighbor(docNavigation[index - 1], 'PRÉCÉDENT')}${neighbor(docNavigation[index + 1], 'À SUIVRE')}</nav></article><aside class="docs-toc"><span>SUR CETTE PAGE</span><nav aria-label="Sommaire">${page.sections.map((s) => `<a href="#${s.id}">${s.title}</a>`).join('')}</nav></aside></main>`
  return shell({ title: `${docNavigation[index].title} — Agentic Workflow`, description: page.description, content, context, active: `docs${slug ? `/${slug}` : ''}` })
}
