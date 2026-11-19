import { codeBlock, escapeHtml, icon, mark, routeLabel, shell } from './ui.mjs'

export const skills = [
  { name: 'start-card', usage: 'Point d’entrée', title: 'Démarrer une carte précise', description: 'Vérifier que la carte est exécutable, déterminer son niveau de risque et préparer ou reprendre son worktree.', icon: 'branch' },
  { name: 'harden-card', usage: 'Facultatif', title: 'Clarifier une carte bloquée', description: 'Préciser le résultat, le périmètre ou la façon de vérifier le changement. Conserver les critères déjà acceptés.', icon: 'grid' },
  { name: 'implement', usage: 'Obligatoire', title: 'Produire un commit vérifié', description: 'Implémenter la carte dans un contexte neuf et enregistrer les contrôles ciblés réussis sur le commit.', icon: 'code' },
  { name: 'code-review', usage: 'Obligatoire', title: 'Relire le commit exact', description: 'Vérifier le diff et ses preuves en contexte indépendant. Le risque détermine si un ou deux reviewers sont requis par tour.', icon: 'review' },
  { name: 'rework', usage: 'Si un défaut bloque', title: 'Corriger les défauts confirmés', description: 'Regrouper les corrections ciblées en un nouveau commit, puis demander une nouvelle revue. Un seul cycle automatique par nouvelle carte.', icon: 'refresh' },
  { name: 'ship-production-change', usage: 'Obligatoire pour livrer', title: 'Confirmer la livraison', description: 'Revérifier les preuves, attendre les checks requis de la PR et confirmer la fusion et le déploiement quand il est requis.', icon: 'check' },
]

const levels = {
  simple: { label: 'Simple', score: '0–4 points', example: 'Ajuster une validation locale.', description: 'Un changement circonscrit, testable indépendamment, avec une review proportionnée.' },
  standard: { label: 'Standard', score: '5–10 points', example: 'Faire évoluer un parcours utilisateur.', description: 'Plusieurs fichiers ou couches, un raisonnement renforcé et une review indépendante.' },
  complex: { label: 'Complex', score: '11–20 points', example: 'Refondre un traitement asynchrone.', description: 'Un périmètre large ou couplé. L’effort passe à high dès 15 points, ou selon les dimensions de risque.' },
  critical: { label: 'Critical', score: 'Contrat sensible', example: 'Modifier les autorisations d’accès.', description: 'Sécurité, paiements ou données sensibles : deux reviewers indépendants, avec deux modèles distincts.' },
}

export function homePage(context) {
  const u = (path) => `${context.basePath}${path}`
  const content = `<main id="main">
<section class="hero page-width">
<div class="eyebrow hero-eyebrow"><span class="status-dot"></span> UNE MÉTHODE OPEN SOURCE POUR L’AGENTIC CODING <span class="version-pill">v${escapeHtml(context.version)}</span></div>
<h1>Vos agents codent.<br>Gardez <em>le fil.</em></h1>
<p class="hero-description">Lancez une carte prête avec <code>/start-card</code>. Les agents implémentent, relisent le commit et vérifient sa livraison avec des contrôles adaptés au risque.</p>
<div class="hero-actions"><a class="button button-accent" href="${u('/docs/installation/')}">Installer le workflow ${icon('arrow')}</a><a class="text-link" href="#methode">Comprendre la méthode <span>↓</span></a></div>
<div class="hero-compatibility"><span>${icon('terminal')} Codex</span><span>${icon('code')} Claude Code <small>commandes</small></span><span>${icon('branch')} Votre repository</span></div>
<div class="workflow-canvas" aria-label="Le parcours d’une carte prête, du démarrage à la livraison">
<div class="canvas-heading"><span class="mini-label"><span class="status-dot"></span> PARCOURS D’UNE CARTE PRÊTE</span><a class="canvas-caption" href="${u('/docs/workflow/#harden')}">Hardening facultatif</a></div>
<div class="diagram-flow">
<div class="flow-node"><div class="flow-icon">${icon('branch')}</div><span class="flow-number">01 / START</span><h3>Démarrer</h3><p>Carte prête à exécuter.<br>Risque et routage vérifiés.</p><span class="node-token">/start-card</span></div>
<span class="flow-arrow">${icon('arrow')}</span>
<div class="flow-node"><div class="flow-icon">${icon('code')}</div><span class="flow-number">02 / IMPLEMENT</span><h3>Implémenter</h3><p>Un worktree isolé.<br>Des preuves sur le commit.</p><span class="node-token">Contrôles ciblés</span></div>
<span class="flow-arrow">${icon('arrow')}</span>
<div class="flow-node review-node"><div class="flow-icon">${icon('review')}</div><span class="flow-number">03 / REVIEW</span><h3>Relire</h3><p>Un commit exact.<br>Un reviewer, deux si critical.</p><span class="node-token">Revue obligatoire</span></div>
<span class="flow-arrow">${icon('arrow')}</span>
<div class="flow-node ship-node"><div class="flow-icon">${icon('check')}</div><span class="flow-number">04 / SHIP</span><h3>Livrer</h3><p>Validation et fusion.<br>Contrôles de production requis.</p><span class="node-token">DONE ${icon('check')}</span></div>
</div>
<div class="rework-loop"><span></span><p>${icon('refresh')} Si un défaut bloque, au plus une correction automatique et une nouvelle revue.</p><span></span></div>
<div class="canvas-footer"><span>01 carte</span><span>01 branche</span><span>01 pull request</span><span class="footer-proof">${icon('lock')} Des preuves à chaque passage</span></div>
</div>
</section>
<section class="manifesto page-width" id="methode"><div class="eyebrow">01 — LA MÉTHODE</div><div class="section-split"><h2>Coder plus vite.<br><em>Livrer avec confiance.</em></h2><p>Chaque carte avance dans un worktree isolé. Les agents se passent le commit et les preuves des contrôles qui permettent de reprendre la livraison.</p></div>
<div class="principles">
<article><span class="principle-icon">${icon('layers')}</span><h3>Une revue indépendante</h3><p>Le reviewer reçoit le ticket, le diff et les preuves des tests. Il juge le comportement attendu et les défauts concrets du commit.</p></article>
<article><span class="principle-icon">${icon('branch')}</span><h3>Une validation adaptée au risque</h3><p>Une carte simple ou standard peut réutiliser ses contrôles ciblés approuvés. Une carte critique requiert deux reviewers indépendants et un contrôle complet.</p></article>
<article><span class="principle-icon">${icon('lock')}</span><h3>Des contrôles avant et après fusion</h3><p>Le projet définit les checks requis sur la PR et les vérifications de production. Les régressions planifiées tournent en arrière-plan.</p><a class="tiny-label" href="${u('/docs/workflow/#ci')}">Voir les contrôles de livraison ${icon('arrow')}</a></article>
</div>
</section>
<section class="routing-section" id="routage"><div class="page-width"><div class="routing-heading"><div><div class="eyebrow">02 — UNE RIGUEUR ADAPTATIVE</div><h2>Chaque changement<br>a son <em>parcours.</em></h2></div><p>Choisissez un niveau pour explorer le routage.<br>Les modèles ci-dessous viennent directement<br>de la configuration du workflow.</p></div>
<div class="routing-demo"><div class="risk-tabs" role="tablist" aria-label="Niveau de complexité">${Object.entries(levels).map(([key, level], index) => `<button id="tab-${key}" type="button" role="tab" aria-controls="panel-${key}" aria-selected="${index === 1}" tabindex="${index === 1 ? '0' : '-1'}" data-risk="${key}"><span class="risk-dot risk-${key}"></span>${level.label}<span class="risk-index">0${index + 1}</span></button>`).join('')}</div>
${Object.entries(levels).map(([key, level], index) => { const route = context.routes[key]; return `<div id="panel-${key}" role="tabpanel" aria-labelledby="tab-${key}" class="route-panel" ${index === 1 ? '' : 'hidden'}><div class="route-scenario"><span class="score-label">${level.score}</span><h3>${level.example}</h3><p>${level.description}</p><a href="${u('/docs/routage/')}">Les critères de classification ${icon('arrow')}</a></div><div class="route-stages"><div class="route-stage"><span class="route-stage-icon">${icon('code')}</span><div><small>IMPLÉMENTATION</small><strong>${routeLabel(route.implementation)}</strong><code>${escapeHtml(route.implementation.model)}</code></div><span class="fresh-label">Contexte neuf</span></div><div class="route-connector"></div>${route.reviewers.map((reviewer, i) => `<div class="route-stage"><span class="route-stage-icon">${icon('review')}</span><div><small>REVIEW ${route.reviewers.length > 1 ? (i === 0 ? 'A' : 'B') : 'INDÉPENDANTE'}</small><strong>${routeLabel(reviewer)}</strong><code>${escapeHtml(reviewer.model)}</code></div><span class="fresh-label">${route.reviewers.length > 1 ? 'Indépendante' : 'Contexte neuf'}</span></div>`).join('')}<div class="route-outcome">${icon('check')} ${route.reviewers.length === 2 ? 'Deux approbations indépendantes requises' : 'Une approbation requise'} sur le commit courant</div></div></div>` }).join('')}
</div><p class="routing-note"><span>Un modèle adapté à la tâche.</span> Luna traite les changements délimités, Sol 6.1 prend les travaux complexes et sensibles. L’effort de raisonnement augmente avec le risque. <a href="${u('/docs/routage/')}">Comprendre ces choix ${icon('arrow')}</a></p>
</div></section>
<section class="skills-section page-width" id="skills"><div class="eyebrow">03 — LA BOÎTE À OUTILS</div><div class="section-split"><h2>Les commandes<br><em>et quand les utiliser.</em></h2><p><code>/start-card</code> lance les phases requises. Utilisez <code>/harden-card</code> si le ticket mérite d’être clarifié avant le démarrage.</p></div><div class="skill-grid">${skills.map((skill) => `<a class="skill-card" href="${u(`/docs/skills/#${skill.name}`)}"><div class="skill-top"><span>${skill.usage}</span>${icon(skill.icon)}</div><code>/${skill.name}</code><h3>${skill.title}</h3><p>${skill.description}</p><span class="skill-link">Explorer le skill ${icon('arrow')}</span></a>`).join('')}</div></section>
<section class="install-section page-width" id="installation"><div class="install-copy"><div class="eyebrow">04 — À VOUS DE JOUER</div><h2>Votre prochaine PR<br>commence <em>ici.</em></h2><p>Clonez la source, installez dans votre repository et configurez votre équipe Linear. Le workflow vous appartient.</p><a class="button button-accent" href="${u('/docs/installation/')}">Suivre le guide d’installation ${icon('arrow')}</a><div class="install-requirements"><span>${icon('check')} Node.js 20+</span><span>${icon('check')} Git</span><span>${icon('check')} Linear</span></div></div><div class="install-terminal"><div class="terminal-title"><span class="terminal-dots"><i></i><i></i><i></i></span><span>un nouveau départ</span><span>~/projects</span></div>${codeBlock(`git clone ${context.repository}.git\ncd agentic-workflow\n./install.sh /chemin/vers/votre-projet`, 'Installer') }<div class="terminal-result"><span>${icon('check')} Des fichiers gérés, des réglages préservés.</span><p>L’update détecte les modifications manuelles et signale les conflits.</p></div></div></section>
<section class="faq-section page-width"><div><div class="eyebrow">QUELQUES REPÈRES</div><h2>Avant de<br><em>vous lancer.</em></h2></div><div class="faq-list">
<details><summary>Dois-je durcir chaque carte ?<span>+</span></summary><p>Une carte sélectionnée explicitement peut démarrer dès que son résultat, son périmètre et ses critères sont clairs. Pour la sélection automatique du backlog, préparez les labels de disponibilité et le commentaire de routage.</p></details>
<details><summary>Quels tests font partie de la PR ?<span>+</span></summary><p>Le contrôle de PR du projet privilégie les tests essentiels, le lint, le typage et les preuves ciblées pour les changements sensibles. La suite large peut tourner sur la branche principale en arrière-plan. Le contrôle de production vérifie le déploiement.</p></details>
<details><summary>Est-ce compatible avec mon projet ?<span>+</span></summary><p>Le workflow est indépendant de votre stack. L’installation demande un dépôt Git et Node.js 20+. Les commandes de validation sont détectées ou configurées dans votre projet.</p></details>
<details><summary>Codex et Claude Code ont-ils les mêmes capacités ?<span>+</span></summary><p>L’orchestration automatique et la boucle de backlog utilisent le CLI Codex. Claude Code fournit des commandes pour les mêmes phases. Les modèles configurés doivent être disponibles sur votre hôte.</p></details>
<details><summary>Mes fichiers seront-ils écrasés lors d’un update ?<span>+</span></summary><p>Les fichiers gérés restés intacts sont mis à jour. Un fichier modifié manuellement est préservé et signalé en conflit. Le projet garde sa propre configuration.</p></details>
<details><summary>Est-ce gratuit ?<span>+</span></summary><p>Le workflow est open source sous licence MIT. L’utilisation des modèles, de votre assistant et des services connectés reste soumise à leurs propres conditions et coûts.</p></details></div></section>
<div class="closing-note page-width"><span class="closing-mark">${mark}</span><p>Gardez votre jugement.<br>Donnez une méthode à vos agents.</p><a href="${context.repository}">Lire le code ${icon('external')}</a></div>
</main>`
  return shell({ title: 'Agentic Workflow — Vos agents codent. Gardez le fil.', description: 'Démarrez une carte prête, vérifiez ses contrôles ciblés et livrez son commit après une revue indépendante adaptée au risque.', content, context, isHome: true })
}
