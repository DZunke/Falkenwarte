<?php

declare(strict_types=1);

namespace App\WorkManagement\Domain;

/** Stable, system-managed projections of open work and waiting reasons. */
final class AttentionLabelCatalog
{
    /** @return array<string, array{name: string, color: string, description: string}> */
    public static function definitions(): array
    {
        return [
            'approval_pending' => ['name' => 'Abnahme erforderlich', 'color' => '#D97706', 'description' => 'Für den aktuellen Ergebnisstand ist eine Eigentümerentscheidung offen.'],
            'task_changed_before_dispatch' => ['name' => 'Aufgabenänderung prüfen', 'color' => '#D97706', 'description' => 'Die Aufgabe änderte sich vor dem Start eines Agentenauftrags.'],
            'reconciliation_required' => ['name' => 'T3-Auftrag klären', 'color' => '#D97706', 'description' => 'Der Ausgang einer externen T3-Ausführung muss geklärt werden.'],
            'auth_required' => ['name' => 'T3-Anmeldung erforderlich', 'color' => '#D97706', 'description' => 'Die T3-Verbindung benötigt eine gültige Anmeldung.'],
            'reference_target_invalid' => ['name' => 'T3-Ziel prüfen', 'color' => '#D97706', 'description' => 'Das referenzierte T3-Ausführungsziel ist nicht verfügbar.'],
            'phase_evidence_pending' => ['name' => 'Nachweise prüfen', 'color' => '#D97706', 'description' => 'Für den Phasenabschluss fehlen erforderliche Meldungen.'],
            'phase_review_pending' => ['name' => 'Nachweise bestätigen', 'color' => '#D97706', 'description' => 'Eine gemeldete Phasenaussage wartet auf menschliche Prüfung.'],
            'phase_criteria_pending' => ['name' => 'Kriterien bestätigen', 'color' => '#D97706', 'description' => 'Ein erforderliches Phasenkriterium wartet auf menschliche Bestätigung.'],
            'workflow_duration_limit' => ['name' => 'Workflowzeit erreicht', 'color' => '#D97706', 'description' => 'Der konfigurierte Workflowzeitraum ist erreicht.'],
            'workflow_repair_limit' => ['name' => 'Überarbeitungsrunde prüfen', 'color' => '#D97706', 'description' => 'Die begrenzte Zahl an Überarbeitungsrunden ist erreicht.'],
            'workflow_transition_required' => ['name' => 'Workflowentscheidung erforderlich', 'color' => '#D97706', 'description' => 'Der nächste Workflowabschnitt benötigt eine Entscheidung.'],
            'workflow_entry_condition_unmet' => ['name' => 'Workflowbedingung offen', 'color' => '#D97706', 'description' => 'Eine Voraussetzung des nächsten Workflowabschnitts ist nicht erfüllt.'],
            'workflow_profile_unavailable' => ['name' => 'Rolle nicht startbereit', 'color' => '#D97706', 'description' => 'Das für den Workflow gewählte Rollenprofil ist nicht startbereit.'],
            'run_permission_in_t3' => ['name' => 'In T3 freigeben', 'color' => '#D97706', 'description' => 'Eine Berechtigung muss direkt in T3 erteilt werden.'],
            'agent_question' => ['name' => 'Agent wartet auf Antwort', 'color' => '#2563EB', 'description' => 'Der meldende Agent wartet auf eine Antwort; dies ist kein Eigentümer-Handlungsgrund.'],
            'routing_ambiguous' => ['name' => 'Workflow wählen', 'color' => '#D97706', 'description' => 'Die Eingangsbewertung konnte keine eindeutige Workflowroute auswählen.'],
            'classification_unavailable' => ['name' => 'Klassifikation prüfen', 'color' => '#D97706', 'description' => 'Die Eingangsklassifikation konnte nicht abgeschlossen werden.'],
            'decision_refused' => ['name' => 'Eingang braucht Entscheidung', 'color' => '#D97706', 'description' => 'Die Eingangsbewertung hat keine automatische Entscheidung geliefert.'],
            'intake_escalated' => ['name' => 'Eingang braucht Aufmerksamkeit', 'color' => '#D97706', 'description' => 'Ein Eingang wurde zur menschlichen Klärung weitergeleitet.'],
            'run_failed' => ['name' => 'Agentenauftrag fehlgeschlagen', 'color' => '#D97706', 'description' => 'Ein Agentenauftrag ist fehlgeschlagen und benötigt Klärung.'],
            'plugin_drain_blocked' => ['name' => 'Pluginarbeit klären', 'color' => '#D97706', 'description' => 'Ein Plugin kann wegen offener Arbeit noch nicht deaktiviert werden.'],
        ];
    }
}
