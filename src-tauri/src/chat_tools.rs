//! Registre canonique des outils activables pour un tour de chat.
//!
//! Les modes fixes restent compacts. Les skills issus du manifeste sont validés
//! puis écrits dans un fichier temporaire lu par le fournisseur, afin de ne pas
//! gonfler la ligne de commande sous Windows.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

const MAX_CHAT_SKILLS: usize = 32;
const MAX_CHAT_SKILL_NAME_CHARS: usize = 160;
const MAX_CHAT_SKILL_CONTENT_BYTES: usize = 64 * 1024;
const MAX_CHAT_SKILLS_TOTAL_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum ChatAgentTool {
    Question,
    Proof,
    ThermoNuclearCodeQualityReview,
    ImpeccableMakeInterfacesFeelBetter,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAgentSkill {
    pub id: String,
    pub name: String,
    pub content: String,
}

const CHAT_AGENT_TOOLS: [ChatAgentTool; 4] = [
    ChatAgentTool::Question,
    ChatAgentTool::Proof,
    ChatAgentTool::ThermoNuclearCodeQualityReview,
    ChatAgentTool::ImpeccableMakeInterfacesFeelBetter,
];

impl ChatAgentTool {
    fn instructions(self) -> &'static str {
        match self {
            Self::Question => {
                "[Mode Question]\n\
Avant toute action, analyse la demande complète et repère les points importants ambigus, incomplets, contradictoires ou dépendants d'un choix utilisateur. S'il en existe, pose toutes les questions nécessaires ensemble au tout début, dans un seul lot concis. Utilise l'outil request_user_input lorsqu'il est disponible, puis attends les réponses avant de commencer le travail. Ne disperse pas les questions au fil de l'exécution. S'il n'existe aucun point réellement ambigu ou bloquant, commence directement sans inventer de question."
            }
            Self::Proof => {
                "[Mode Preuve]\n\
Ne déclare pas le travail terminé sans preuve concrète et vérifiable de son fonctionnement. Exécute les validations pertinentes (tests, compilation, commandes ou scénario réel) et rapporte leurs résultats. Pour une modification visuelle ou d'interface, ouvre si possible l'application réelle et génère une capture d'écran enregistrée comme artefact. Dans la réponse finale, identifie clairement les preuves produites, notamment les commandes, résultats et chemins des captures. Si une preuve attendue est techniquement impossible, explique précisément pourquoi et fournis la meilleure vérification reproductible disponible. N'invente jamais de preuve."
            }
            Self::ThermoNuclearCodeQualityReview => {
                "[thermo-nuclear-code-quality-review]\n\
Exécute une revue de qualité de code profonde, stricte et orientée maintenabilité. Commence par lire les consignes du dépôt, inspecter le diff et comprendre les couches concernées. Cherche d'abord les défauts structurels plutôt que les détails cosmétiques : spaghetti et responsabilités mélangées, fichiers démesurés (plus de 1 000 lignes est un signal fort), duplication, frontières non typées, états impossibles, abstractions fuyantes, absence de couche canonique, orchestration non atomique, concurrence dangereuse et validations insuffisantes. Favorise le « code judo » : supprimer ou simplifier avant d'ajouter, centraliser les invariants et obtenir un fort effet avec peu de code. Ne te contente jamais de « ça marche ». Pour une demande de construction ou correction, répare dans le périmètre les problèmes à haute confiance puis revalide compilation, tests ciblés et scénarios critiques. Pour une demande de revue seule, ne modifie rien et livre d'abord les constats actionnables, classés par sévérité, avec fichiers et lignes. Ignore les artefacts générés et n'invente aucun défaut."
            }
            Self::ImpeccableMakeInterfacesFeelBetter => {
                "[impeccable + make-interfaces-feel-better]\n\
Lorsque la demande touche une interface, exécute ensemble les workflows impeccable et make-interfaces-feel-better. Inspecte l'interface réellement rendue dans un navigateur et utilise le détecteur ou la CLI Impeccable du projet quand ils sont disponibles. Audite puis améliore à haute confiance la hiérarchie visuelle, contraste, typographie, rythme, responsive, états vides/chargement/erreur, clavier, focus, libellés et accessibilité. Affine les micro-interactions : rayons concentriques, alignement optique, ombres crédibles, lissage des polices, chiffres tabulaires, wrapping du texte, contours d'images, cibles tactiles d'au moins 44 px sur écran tactile, pression autour de 0,96, animations interruptibles et respect de prefers-reduced-motion. N'utilise jamais transition: all et évite les effets décoratifs génériques sans intention. Vérifie plusieurs tailles d'écran et les interactions réelles, puis fournis dans la réponse finale un tableau concis avant/après et les preuves visuelles ou techniques. Si le tour ne concerne aucune interface, indique brièvement que l'outil n'est pas applicable au lieu d'inventer un travail UI."
            }
        }
    }
}

pub fn normalize_chat_agent_tools(
    requested: &[ChatAgentTool],
    legacy_question: bool,
    legacy_proof: bool,
) -> Vec<ChatAgentTool> {
    CHAT_AGENT_TOOLS
        .into_iter()
        .filter(|tool| {
            requested.contains(tool)
                || (legacy_question && *tool == ChatAgentTool::Question)
                || (legacy_proof && *tool == ChatAgentTool::Proof)
        })
        .collect()
}

pub fn chat_tool_instructions(
    requested: &[ChatAgentTool],
    legacy_question: bool,
    legacy_proof: bool,
) -> Option<String> {
    let tools = normalize_chat_agent_tools(requested, legacy_question, legacy_proof);
    if tools.is_empty() {
        return None;
    }
    let sections = tools
        .into_iter()
        .map(ChatAgentTool::instructions)
        .collect::<Vec<_>>()
        .join("\n\n");
    Some(format!(
        "Outils de conduite explicitement activés par l'utilisateur pour ce tour. Applique uniquement les modes ci-dessous, en plus de la demande utilisateur.\n\n<chat_agent_tools>\n{sections}\n</chat_agent_tools>"
    ))
}

pub fn chat_skills_document(requested_skills: &[ChatAgentSkill]) -> Result<Option<String>, String> {
    if requested_skills.len() > MAX_CHAT_SKILLS {
        return Err(format!("Trop de skills actifs (maximum {MAX_CHAT_SKILLS})"));
    }
    let mut sections = Vec::new();
    let mut seen = HashSet::new();
    let mut total_bytes = 0usize;
    for skill in requested_skills {
        let id = skill.id.trim();
        let name = skill.name.trim();
        let content = skill.content.trim();
        if id.is_empty()
            || id.len() > 128
            || !id.bytes().all(|byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(&byte)
            })
        {
            return Err("Identifiant de skill invalide".to_string());
        }
        if !seen.insert(id.to_string()) || content.is_empty() {
            continue;
        }
        if name.is_empty() || name.chars().count() > MAX_CHAT_SKILL_NAME_CHARS {
            return Err(format!("Nom du skill « {id} » invalide"));
        }
        if content.len() > MAX_CHAT_SKILL_CONTENT_BYTES {
            return Err(format!("Le skill « {name} » est trop volumineux"));
        }
        total_bytes = total_bytes.saturating_add(content.len());
        if total_bytes > MAX_CHAT_SKILLS_TOTAL_BYTES {
            return Err("Le contenu cumulé des skills est trop volumineux".to_string());
        }
        sections.push(format!("## {name}\n\nId : `{id}`\n\n{content}"));
    }
    if sections.is_empty() {
        return Ok(None);
    }
    let sections = sections.join("\n\n");
    Ok(Some(format!(
        "# Skills actifs pour ce tour\n\n{sections}\n"
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serde_ids_match_the_frontend_contract() {
        let values = CHAT_AGENT_TOOLS
            .into_iter()
            .map(|tool| serde_json::to_value(tool).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            values,
            vec![
                "question",
                "proof",
                "thermo-nuclear-code-quality-review",
                "impeccable-make-interfaces-feel-better",
            ]
        );
    }

    #[test]
    fn tools_are_deduplicated_ordered_and_legacy_compatible() {
        let tools = normalize_chat_agent_tools(
            &[
                ChatAgentTool::ImpeccableMakeInterfacesFeelBetter,
                ChatAgentTool::Proof,
                ChatAgentTool::Proof,
            ],
            true,
            false,
        );
        assert_eq!(
            tools,
            vec![
                ChatAgentTool::Question,
                ChatAgentTool::Proof,
                ChatAgentTool::ImpeccableMakeInterfacesFeelBetter,
            ]
        );
    }

    #[test]
    fn advanced_tools_generate_independent_instructions() {
        let thermo = chat_tool_instructions(
            &[ChatAgentTool::ThermoNuclearCodeQualityReview],
            false,
            false,
        )
        .unwrap();
        assert!(thermo.contains("[thermo-nuclear-code-quality-review]"));
        assert!(thermo.contains("code judo"));
        assert!(!thermo.contains("make-interfaces-feel-better"));

        let interface = chat_tool_instructions(
            &[ChatAgentTool::ImpeccableMakeInterfacesFeelBetter],
            false,
            false,
        )
        .unwrap();
        assert!(interface.contains("impeccable + make-interfaces-feel-better"));
        assert!(interface.contains("avant/après"));
        assert!(!interface.contains("thermo-nuclear-code-quality-review"));
    }

    #[test]
    fn manifest_skills_are_deduplicated_in_the_turn_document() {
        let skill = ChatAgentSkill {
            id: "impeccable".to_string(),
            name: "Impeccable".to_string(),
            content: "Inspecte l'interface réellement rendue.".to_string(),
        };
        let instructions = chat_skills_document(&[skill.clone(), skill])
            .unwrap()
            .unwrap();
        assert!(instructions.contains("## Impeccable"));
        assert!(instructions.contains("Id : `impeccable`"));
        assert_eq!(
            instructions
                .match_indices("Inspecte l'interface réellement rendue.")
                .count(),
            1
        );
    }
}
